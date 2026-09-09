"""Offline feasibility probe; no providers, credentials, downloads or vault access.

Run against separately obtained, revision-pinned official repositories:
python3 scripts/probe-review-engines.py --scholarqa /path/to/scholarqa --openscholar /path/to/openscholar

Executes ScholarQA's actual pipeline class with fixture completions substituted
at its two module-level model-call boundaries. This is NOT a quality benchmark
or a production engine adapter. No upstream package initializers are imported.
"""
import argparse
import ast
import contextlib
from collections import namedtuple
import json
import logging
from pathlib import Path
import re
import subprocess
import io
from types import SimpleNamespace


def revision(path):
    return subprocess.check_output(["git", "-C", str(path), "rev-parse", "HEAD"], text=True).strip()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--scholarqa", type=Path, required=True)
    parser.add_argument("--openscholar", type=Path, required=True)
    args = parser.parse_args()
    path = args.scholarqa / "api/scholarqa/rag/multi_step_qa_pipeline.py"
    source = ast.parse(path.read_text())
    cls = next(node for node in source.body if isinstance(node, ast.ClassDef) and node.name == "MultiStepQAPipeline")
    completions = []
    result = namedtuple("Result", ["content"])

    def batch(model, messages, **kwargs):
        assert model == "configured-model" and kwargs["fallback"] is None
        completions.append({"stage": "quotes", "calls": len(messages)})
        return [result(json.dumps({"quote": quote})) for quote in [
            "Listeners showed better decoding in quiet conditions.",
            "No improvement was observed in noisy conditions.",
        ]]

    def single(**kwargs):
        assert kwargs["model"] == "configured-model" and kwargs["fallback"] is None
        if "response_format" in kwargs:
            completions.append({"stage": "outline", "calls": 1})
            return result(json.dumps({"dimensions": [
                {"name": "Findings", "format": "synthesis", "quotes": [0, 1]},
                {"name": "Limitations", "format": "synthesis", "quotes": [1]},
            ]}))
        completions.append({"stage": "section", "calls": 1})
        return result("Fixture section: " + kwargs["user_prompt"])

    # Only the audited pipeline class executes. Type annotation dependencies are
    # postponed; a dictionary supplies the two DataFrame columns this stage uses.
    namespace = {
        "json": json, "re": re, "logger": logging.getLogger("probe"),
        "GPT_4o": "must-not-fallback", "QuoteOutput": object, "ClusterPlan": object,
        "batch_llm_completion": batch, "llm_completion": single,
        "USER_PROMPT_PAPER_LIST_FORMAT": "Question: {}\nPaper: {}",
        "USER_PROMPT_QUOTE_LIST_FORMAT": "Question: {}\nQuotes: {}",
        "PROMPT_ASSEMBLE_NO_QUOTES_SUMMARY": "NO EVIDENCE: {section_name}",
    }
    module = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), cls], type_ignores=[])
    exec(compile(ast.fix_missing_locations(module), str(path), "exec"), namespace)
    pipeline = namespace["MultiStepQAPipeline"]("configured-model", fallback_llm=None, batch_workers=1)
    records = {
        "reference_string": ["[paper-a]", "[paper-b]"],
        "relevance_judgment_input_expanded": [
            "Listeners showed better decoding in quiet conditions.",
            "No improvement was observed in noisy conditions.",
        ],
    }
    quotes, _ = pipeline.step_select_quotes("Compare decoding studies", records, "fixture")
    assert set(quotes) == {"[paper-a]", "[paper-b]"}
    # JSON round-trip the completed stage to prove the next stage accepts a
    # checkpoint without retrieving/extracting the papers again.
    quotes = json.loads(json.dumps(quotes))
    outline, _ = pipeline.step_clustering("Compare decoding studies", quotes, "fixture")
    plan = {item["name"]: item["quotes"] for item in outline["dimensions"]}
    prompt = "{query}\n{plan}\n{already_written}\n{section_name}\n{section_references}"
    sections = list(pipeline.generate_iterative_summary("Compare decoding studies", quotes, plan, prompt))
    assert len(sections) == 2 and "quiet conditions" in sections[0].content
    assert "noisy conditions" in sections[0].content
    assert completions == [{"stage": "quotes", "calls": 2}, {"stage": "outline", "calls": 1}, {"stage": "section", "calls": 1}, {"stage": "section", "calls": 1}]
    # Upstream only checks the upper bound: negative indices are accepted.
    # Record this explicitly as an adapter validation requirement.
    negative = list(pipeline.generate_iterative_summary("q", quotes, {"Invalid": [-1]}, prompt))
    assert "[paper-b]" in negative[0].content
    other = ast.parse((args.openscholar / "src/open_scholar.py").read_text())
    imports = [alias.name for node in other.body if isinstance(node, ast.Import) for alias in node.names]
    assert "vllm" in imports and "spacy" in imports
    # Execute its actual API generation/critique/edit path independently of
    # GPU/NLP imports. No host inference, retrieval index or paid API is needed.
    # This isolates feasibility; it is not equivalent to installing the package.
    other_cls = next(node for node in other.body if isinstance(node, ast.ClassDef) and node.name == "OpenScholar")
    instruction_ast = ast.parse((args.openscholar / "src/instructions.py").read_text())
    values = {}
    for node in instruction_ast.body:
        if isinstance(node, ast.Assign) and isinstance(node.targets[0], ast.Name):
            try:
                values[node.targets[0].id] = ast.literal_eval(node.value)
            except (ValueError, TypeError):
                pass
    # A few prompt assignments concatenate earlier literal constants. Execute
    # only those assignment expressions in order, with no imports or builtins.
    prompt_nodes = [node for node in instruction_ast.body if isinstance(node, ast.Assign)]
    exec(compile(ast.fix_missing_locations(ast.Module(body=prompt_nodes, type_ignores=[])),
                 "upstream_prompt_constants", "exec"), {"__builtins__": {}}, values)
    api_calls = []
    generated = "The fixture found improved decoding in quiet conditions [0]. The noisy condition showed no improvement [1]."

    def create(**kwargs):
        assert kwargs["model"] == "configured-model"
        api_calls.append({"max_tokens": kwargs["max_tokens"]})
        text = "Feedback: Distinguish conditions more clearly.\n" if len(api_calls) == 2 else generated
        return SimpleNamespace(choices=[SimpleNamespace(message=SimpleNamespace(content=text))])

    ns = {"re": re, "instructions": SimpleNamespace(**values),
          "calculate_openai_api_cost": lambda *_: 0, "tqdm": lambda value: value}
    mod = ast.Module(body=[ast.ImportFrom(module="__future__", names=[ast.alias(name="annotations")], level=0), other_cls], type_ignores=[])
    exec(compile(ast.fix_missing_locations(mod), str(args.openscholar / "src/open_scholar.py"), "exec"), ns)
    api = SimpleNamespace(chat=SimpleNamespace(completions=SimpleNamespace(create=create)))
    candidate = ns["OpenScholar"](None, None, client=api, api_model_name="configured-model")
    with contextlib.redirect_stdout(io.StringIO()):
        output, _ = candidate.run({"input": "Compare conditions", "ctxs": [
            {"title": "Quiet fixture", "text": "Improved decoding in quiet conditions."},
            {"title": "Noise fixture", "text": "No improvement in noisy conditions."},
        ]}, use_feedback=True, zero_shot=True)
    assert len(api_calls) == 3 and "no improvement" in output["output"]
    # The critique parser requires Question on the same line; the common
    # separate-line format silently loses follow-up retrieval questions.
    separate_line = candidate.process_feedback("Feedback: Missing evidence.\nQuestion: Follow-up query?\n")
    same_line = candidate.process_feedback("Feedback: Missing evidence. Question: Follow-up query?\n")
    assert separate_line[0][1] == "" and same_line[0][1] == "Follow-up query?"
    print(json.dumps({
        "kind": "offline-integration-probe-not-quality-evaluation",
        "scholarqa": {"revision": revision(args.scholarqa), "actual_upstream_stage_execution": "passed",
                      "checkpoint_quote_round_trip": "passed", "fallback_disabled": True,
                      "requires_negative_index_validation": True},
        "openscholar": {"revision": revision(args.openscholar), "unconditional_imports": imports,
                       "isolated_actual_api_class_execution": "passed", "api_calls_injected": api_calls,
                       "full_package_installed": False, "separate_line_feedback_loses_query": True,
                       "reason": "API class is portable, but package imports and retrieval/posthoc dependencies still require adaptation"},
        "paid_calls": 0,
    }, indent=2))


if __name__ == "__main__":
    main()
