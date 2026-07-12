import type { ChatSource } from "@/stores/chat-store";

interface MockResponse {
  sections: { heading: string; body: string }[];
  sources: ChatSource[];
  followUps: string[];
}

// Response 1: Psilocybin therapy
const psilocybinResponse: MockResponse = {
  sections: [
    {
      heading: "Overview",
      body:
        "Psilocybin-assisted psychotherapy has emerged as a promising intervention for treatment-resistant depression and end-of-life psychological distress [1][2]. Clinical trials have demonstrated rapid and sustained antidepressant effects following one to two supervised sessions, with response rates exceeding those of conventional pharmacotherapy in select populations [3]. The mechanism is thought to involve transient 5-HT2A receptor agonism leading to neuroplasticity and disruption of maladaptive default mode network activity [4].",
    },
    {
      heading: "Key Evidence",
      body:
        "A landmark randomized controlled trial published in NEJM found that a single high-dose psilocybin session produced significant reductions in MADRS scores at six weeks compared to escitalopram [2]. A phase 2 trial in JAMA Psychiatry demonstrated that 71% of participants with major depressive disorder achieved response criteria at one month, with 54% in remission [1]. Long-term follow-up data suggest durability of effect up to 12 months in a subset of responders, though larger confirmatory trials are ongoing [5][6].",
    },
    {
      heading: "Clinical Considerations",
      body:
        "Patient screening is critical, as contraindications include personal or family history of psychosis, bipolar I disorder, and concurrent use of serotonergic agents [3]. The therapeutic context — preparation, the dosing session itself, and integration — is considered an integral component of efficacy and not merely incidental to the pharmacological effect [4]. Regulatory pathways remain in development; as of 2024 the FDA has granted Breakthrough Therapy designation, and several jurisdictions have established supervised access frameworks [6].",
    },
  ],
  sources: [
    {
      title: "Psilocybin produces substantial and sustained decreases in depression and anxiety in patients with life-threatening cancer",
      journal: "Journal of Psychopharmacology",
      url: "https://doi.org/10.1177/0269881116675513",
    },
    {
      title: "Trial of Psilocybin versus Escitalopram for Depression",
      journal: "New England Journal of Medicine",
      url: "https://doi.org/10.1056/NEJMoa2032994",
    },
    {
      title: "Single-dose psilocybin for a treatment-resistant episode of major depression",
      journal: "NEJM Evidence",
      url: "https://doi.org/10.1056/EVIDoa2200036",
    },
    {
      title: "Psilocybin with psychological support for treatment-resistant depression: an open-label feasibility study",
      journal: "Lancet Psychiatry",
      url: "https://doi.org/10.1016/S2215-0366(16)30065-7",
    },
    {
      title: "Effects of psilocybin-assisted therapy on major depressive disorder: a randomized clinical trial",
      journal: "JAMA Psychiatry",
      url: "https://doi.org/10.1001/jamapsychiatry.2020.3285",
    },
    {
      title: "Durability of antidepressant response to psilocybin: a systematic review and meta-analysis",
      journal: "Journal of Affective Disorders",
      url: "https://doi.org/10.1016/j.jad.2023.01.075",
    },
  ],
  followUps: [
    "What are the neuroimaging correlates of psilocybin's antidepressant effects on the default mode network?",
    "How does psilocybin therapy compare to ketamine infusion for treatment-resistant depression?",
    "What are the current FDA regulatory requirements for psychedelic-assisted psychotherapy trials?",
  ],
};

// Response 2: Treatment-resistant depression
const trdResponse: MockResponse = {
  sections: [
    {
      heading: "Current Treatment Landscape",
      body:
        "Treatment-resistant depression (TRD) is conventionally defined as failure to achieve adequate response after at least two adequate antidepressant trials of sufficient dose and duration [1]. Approximately 30% of patients with major depressive disorder meet TRD criteria, representing a substantial public health burden with elevated rates of disability and suicide [2]. Current evidence-based options include lithium augmentation, atypical antipsychotic augmentation, thyroid hormone supplementation, and electroconvulsive therapy (ECT) [1][3].",
    },
    {
      heading: "Novel Approaches",
      body:
        "Esketamine (Spravato) nasal spray received FDA approval in 2019 as the first rapid-acting antidepressant for TRD, demonstrating significant reductions in depressive symptoms within hours of administration via NMDA receptor antagonism [4]. Transcranial magnetic stimulation (TMS), particularly deep TMS and theta-burst protocols, has shown efficacy in TRD with a favorable side-effect profile compared to ECT [3]. Emerging pharmacological targets include AMPA receptor potentiators, GABA-A positive allosteric modulators such as zuranolone, and anti-inflammatory agents in patients with elevated CRP [5].",
    },
    {
      heading: "Evidence Comparison",
      body:
        "Meta-analytic data indicate ECT remains the most effective intervention for TRD, with response rates of 50–70%, though relapse after discontinuation is high without pharmacological continuation [3]. Ketamine and esketamine produce rapid but often transient responses, with effects typically attenuating within two weeks without repeated dosing [4]. Comparative effectiveness research is limited by heterogeneity in TRD definitions and outcome measures, highlighting the need for consensus staging systems such as the Maudsley Treatment Inventory [1][2].",
    },
  ],
  sources: [
    {
      title: "The definition and measurement of treatment-resistant depression: a critical review",
      journal: "Journal of Clinical Psychiatry",
      url: "https://doi.org/10.4088/JCP.18r12055",
    },
    {
      title: "Prevalence and correlates of treatment-resistant depression in the United States: results from a nationally representative survey",
      journal: "Journal of Affective Disorders",
      url: "https://doi.org/10.1016/j.jad.2019.06.011",
    },
    {
      title: "Electroconvulsive therapy versus pharmacotherapy for treatment-resistant depression: a systematic review and meta-analysis",
      journal: "British Journal of Psychiatry",
      url: "https://doi.org/10.1192/bjp.2021.127",
    },
    {
      title: "Intranasal esketamine for treatment-resistant depression: a randomized, double-blind study",
      journal: "American Journal of Psychiatry",
      url: "https://doi.org/10.1176/appi.ajp.2019.19010073",
    },
    {
      title: "Biomarker-guided treatment selection in major depressive disorder: from inflammation to precision psychiatry",
      journal: "JAMA Psychiatry",
      url: "https://doi.org/10.1001/jamapsychiatry.2022.1388",
    },
  ],
  followUps: [
    "What biomarkers predict response to ketamine versus ECT in treatment-resistant depression?",
    "How does the Maudsley Treatment Inventory define and stage treatment resistance in depression?",
    "What is the evidence for anti-inflammatory augmentation strategies in patients with elevated CRP and depression?",
  ],
};

// Response 3: Anxiety and PTSD
const anxietyPtsdResponse: MockResponse = {
  sections: [
    {
      heading: "Pathophysiology",
      body:
        "Post-traumatic stress disorder (PTSD) and anxiety disorders share overlapping neurobiological substrates, including hyperreactivity of the amygdala, impaired prefrontal cortical regulation, and dysregulation of the hypothalamic-pituitary-adrenal (HPA) axis [1][2]. Aberrant fear conditioning and failure of extinction learning are central to symptom maintenance, mediated in part by reduced hippocampal volume and compromised vmPFC-amygdala connectivity [3]. Inflammatory signaling pathways and glucocorticoid receptor sensitivity alterations have been increasingly implicated in both conditions, particularly in trauma-exposed individuals [4].",
    },
    {
      heading: "Pharmacological Interventions",
      body:
        "SSRIs (sertraline, paroxetine) and SNRIs (venlafaxine) remain first-line pharmacotherapy for both PTSD and generalized anxiety disorder based on robust randomized controlled trial evidence [5][6]. Prazosin, an alpha-1 adrenergic antagonist, has demonstrated efficacy for trauma-related nightmares and sleep disturbance in PTSD, though a large VA cooperative study yielded negative results [7]. Benzodiazepines are generally contraindicated in PTSD due to evidence suggesting interference with fear extinction and potential for dependence [5].",
    },
    {
      heading: "Emerging Therapies",
      body:
        "MDMA-assisted psychotherapy for PTSD has shown remarkable efficacy in Phase 2 trials, with 67% of participants no longer meeting PTSD diagnostic criteria after three sessions compared to 32% on placebo with therapy [6]. Stellate ganglion block, a regional anesthetic procedure, has generated interest based on preliminary RCT data suggesting reduction in PTSD symptom severity via modulation of nerve growth factor signaling [2]. Intranasal neuropeptide Y and oxytocin are under investigation as potential augmentation strategies targeting the neurobiological substrates of fear dysregulation [1][3].",
    },
  ],
  sources: [
    {
      title: "Neurobiology of PTSD: from animal models to human neuroscience",
      journal: "Nature Reviews Neuroscience",
      url: "https://doi.org/10.1038/s41583-019-0223-2",
    },
    {
      title: "Stellate ganglion block for PTSD: a randomized controlled trial",
      journal: "JAMA Psychiatry",
      url: "https://doi.org/10.1001/jamapsychiatry.2019.3474",
    },
    {
      title: "Fear extinction and the prefrontal cortex: lessons from anxiety disorders",
      journal: "Neuropsychopharmacology",
      url: "https://doi.org/10.1038/s41386-020-0826-7",
    },
    {
      title: "Inflammatory biomarkers and treatment outcomes in PTSD and anxiety: a systematic review",
      journal: "Brain, Behavior, and Immunity",
      url: "https://doi.org/10.1016/j.bbi.2021.03.012",
    },
    {
      title: "Pharmacotherapy for PTSD: a systematic review and meta-analysis",
      journal: "Lancet Psychiatry",
      url: "https://doi.org/10.1016/S2215-0366(18)30339-5",
    },
    {
      title: "MDMA-assisted psychotherapy for severe PTSD: a randomized, double-blind, placebo-controlled phase 3 study",
      journal: "Nature Medicine",
      url: "https://doi.org/10.1038/s41591-021-01336-3",
    },
    {
      title: "Neuropeptide Y in the amygdala and hippocampus modulates anxiety and PTSD-like behavior in rodent models",
      journal: "Biological Psychiatry",
      url: "https://doi.org/10.1016/j.biopsych.2020.07.002",
    },
  ],
  followUps: [
    "What are the proposed mechanisms by which MDMA facilitates fear extinction during psychotherapy-assisted sessions?",
    "How does prolonged exposure therapy compare to EMDR in terms of neurobiological changes in PTSD?",
    "What is the current evidence for using beta-blockers like propranolol to disrupt reconsolidation of traumatic memories?",
  ],
};

const responses: MockResponse[] = [psilocybinResponse, trdResponse, anxietyPtsdResponse];

export function getMockResponse(question: string): MockResponse {
  const q = question.toLowerCase();

  if (
    q.includes("psilocybin") ||
    q.includes("psychedelic") ||
    q.includes("mdma") ||
    q.includes("ketamine") ||
    q.includes("mushroom")
  ) {
    return psilocybinResponse;
  }

  if (
    q.includes("treatment-resistant") ||
    q.includes("trd") ||
    q.includes("depression") ||
    q.includes("antidepressant") ||
    q.includes("ect") ||
    q.includes("esketamine")
  ) {
    return trdResponse;
  }

  if (
    q.includes("anxiety") ||
    q.includes("ptsd") ||
    q.includes("trauma") ||
    q.includes("fear") ||
    q.includes("panic") ||
    q.includes("gad")
  ) {
    return anxietyPtsdResponse;
  }

  // Cycle through responses based on question length as a simple heuristic
  return responses[question.length % responses.length];
}
