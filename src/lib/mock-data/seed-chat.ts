import type { ChatSession } from "@/stores/chat-store";

// Fixed timestamp to avoid server/client hydration mismatch
const now = 1743100000000; // ~March 2025

export const seedSessions: ChatSession[] = [
  {
    id: "seed-psilocybin",
    title: "How effective is psilocybin therapy for treatment-resistant depression?",
    createdAt: now - 3600000,
    updatedAt: now - 3500000,
    messages: [
      {
        id: "seed-msg-1",
        role: "user",
        content: "How effective is psilocybin therapy for treatment-resistant depression?",
        timestamp: now - 3600000,
      },
      {
        id: "seed-msg-2",
        role: "assistant",
        content: "",
        timestamp: now - 3597000,
        sections: [
          {
            heading: "Overview",
            body: "Psilocybin-assisted psychotherapy has emerged as one of the most promising interventions for treatment-resistant depression (TRD), with multiple randomized controlled trials demonstrating rapid and sustained antidepressant effects [1][2]. Unlike conventional antidepressants that require weeks to take effect, psilocybin produces clinically meaningful improvements within 24 hours of a single supervised session, with benefits persisting for weeks to months [3].",
          },
          {
            heading: "Key Clinical Evidence",
            body: "The landmark COMPASS Pathways phase 2b trial enrolled 233 patients with TRD and found that a single 25mg psilocybin dose produced a response rate of 37% at three weeks, compared to 18% with 1mg (active control) [1]. A separate trial published in NEJM directly compared psilocybin to escitalopram over 6 weeks, finding comparable efficacy on the primary outcome but significantly faster onset and greater remission rates favoring psilocybin [2]. Long-term follow-up data from Johns Hopkins show that 75% of initial responders maintained clinically significant improvement at 12 months [4].",
          },
          {
            heading: "Safety & Practical Considerations",
            body: "Adverse effects are generally transient and include headache, nausea, and psychological distress during the acute session, with no evidence of physical dependence [3][5]. Contraindications include personal or family history of psychotic disorders, bipolar I, and concurrent use of serotonergic medications. The therapeutic setting — including preparation, guided session, and integration therapy — is considered essential to outcomes and distinguishes this from recreational use [6]. As of 2025, psilocybin has FDA Breakthrough Therapy designation, with phase 3 trials underway.",
          },
        ],
        sources: [
          { title: "Single-Dose Psilocybin for a Treatment-Resistant Episode of Major Depression", journal: "NEJM", url: "#" },
          { title: "Trial of Psilocybin versus Escitalopram for Depression", journal: "NEJM", url: "#" },
          { title: "Psilocybin with psychological support for treatment-resistant depression", journal: "Lancet Psychiatry", url: "#" },
          { title: "Long-term follow-up of psilocybin-facilitated smoking cessation", journal: "JAMA Psychiatry", url: "#" },
          { title: "Psilocybin produces substantial and sustained decreases in depression and anxiety", journal: "J Psychopharmacol", url: "#" },
          { title: "Safety and efficacy of psilocybin in treatment-resistant depression: a systematic review", journal: "Br J Psychiatry", url: "#" },
        ],
        followUps: [
          "How does psilocybin compare to ketamine for TRD?",
          "What are the neurobiological mechanisms behind psilocybin's antidepressant effects?",
          "Which patient populations should be excluded from psilocybin therapy?",
        ],
      },
    ],
  },
  {
    id: "seed-dbs",
    title: "What are the latest DBS targets for treatment-resistant depression?",
    createdAt: now - 86400000,
    updatedAt: now - 86300000,
    messages: [
      {
        id: "seed-msg-3",
        role: "user",
        content: "What are the latest DBS targets for treatment-resistant depression?",
        timestamp: now - 86400000,
      },
      {
        id: "seed-msg-4",
        role: "assistant",
        content: "",
        timestamp: now - 86397000,
        sections: [
          {
            heading: "Current DBS Targets for Depression",
            body: "Deep brain stimulation for treatment-resistant depression has been investigated across multiple anatomical targets, with the subcallosal cingulate (SCC, Brodmann area 25) and the ventral capsule/ventral striatum (VC/VS) being the most extensively studied [1][2]. Recent trials have also explored the medial forebrain bundle (MFB) as a target, with preliminary data suggesting faster onset of antidepressant effects [3].",
          },
          {
            heading: "Clinical Trial Results",
            body: "The BROADEN trial targeting the SCC initially failed to meet its primary endpoint in a randomized phase, but long-term open-label follow-up showed 55% response rates at 2 years, with continued improvement observed through year 8 in sustained responders [1]. The MFB target has shown particularly promising rapid-onset effects, with some patients reporting mood improvement within days rather than weeks [3]. A recent multicenter RCT using tractography-guided SCC DBS achieved 73% response at 12 months, suggesting that individualized targeting may be key [4].",
          },
          {
            heading: "Future Directions",
            body: "Closed-loop (adaptive) DBS systems that modulate stimulation based on real-time neural biomarkers represent the next frontier [5]. Researchers at UCSF have demonstrated proof-of-concept for a system that detects depression-specific neural signatures and delivers targeted stimulation only when needed, potentially improving both efficacy and battery life. Combinatorial approaches pairing DBS with psychotherapy or pharmacotherapy are also being explored to enhance response rates beyond those achieved with neurostimulation alone [2][5].",
          },
        ],
        sources: [
          { title: "Subcallosal cingulate deep brain stimulation for treatment-resistant depression", journal: "Nature Medicine", url: "#" },
          { title: "Deep brain stimulation of the ventral capsule/ventral striatum for treatment-resistant depression", journal: "Biol Psychiatry", url: "#" },
          { title: "Rapid antidepressant effects of DBS to the medial forebrain bundle", journal: "Neuropsychopharmacology", url: "#" },
          { title: "Tractography-guided individualized DBS for depression: a multicenter RCT", journal: "Am J Psychiatry", url: "#" },
          { title: "Closed-loop neuromodulation for treatment-resistant depression", journal: "Nature Biotechnol", url: "#" },
        ],
        followUps: [
          "How does closed-loop DBS differ from traditional open-loop stimulation?",
          "What are the risks and side effects of DBS for depression?",
          "How do DBS outcomes compare to TMS for treatment-resistant depression?",
        ],
      },
    ],
  },
  {
    id: "seed-mdma",
    title: "MDMA-assisted therapy PTSD outcomes",
    createdAt: now - 172800000,
    updatedAt: now - 172700000,
    messages: [
      {
        id: "seed-msg-5",
        role: "user",
        content: "What are the latest results for MDMA-assisted therapy in PTSD?",
        timestamp: now - 172800000,
      },
      {
        id: "seed-msg-6",
        role: "assistant",
        content: "",
        timestamp: now - 172797000,
        sections: [
          {
            heading: "Phase 3 Trial Results",
            body: "The MAPP1 phase 3 trial demonstrated that MDMA-assisted therapy produced a clinically and statistically significant reduction in PTSD symptoms compared to placebo with therapy [1]. At 18 weeks, 67% of the MDMA group no longer met diagnostic criteria for PTSD, compared to 32% in the placebo group. The effect size (Cohen's d = 0.91) was notably larger than those typically seen with SSRIs or trauma-focused psychotherapy alone [2].",
          },
          {
            heading: "Mechanism & Protocol",
            body: "MDMA (3,4-methylenedioxymethamphetamine) is believed to facilitate psychotherapy by reducing fear responses, enhancing emotional empathy, and increasing oxytocin levels, creating a therapeutic window for processing traumatic memories [3][4]. The protocol involves three preparation sessions, three 8-hour MDMA-assisted therapy sessions spaced one month apart, and nine integration sessions. The drug is administered in a clinical setting with two trained therapists present throughout [1].",
          },
          {
            heading: "Regulatory Status & Concerns",
            body: "An FDA advisory committee initially voted against approval in 2024, citing concerns about functional unblinding and potential for misuse [5]. However, MAPS has submitted additional data addressing these concerns, and revised regulatory submissions are expected in 2025. Meanwhile, several countries including Australia have approved MDMA-assisted therapy under supervised frameworks [6][7]. Long-term safety data through 3.5 years of follow-up show no evidence of neurotoxicity or substance dependence at therapeutic doses.",
          },
        ],
        sources: [
          { title: "MDMA-assisted therapy for severe PTSD: a randomized, double-blind, placebo-controlled phase 3 study", journal: "Nature Medicine", url: "#" },
          { title: "Effect size comparison of PTSD treatments: a network meta-analysis", journal: "JAMA Psychiatry", url: "#" },
          { title: "MDMA-assisted psychotherapy: mechanism of action and therapeutic application", journal: "Pharmacol Rev", url: "#" },
          { title: "Oxytocin and social cognition in MDMA-assisted therapy", journal: "Biol Psychiatry", url: "#" },
          { title: "FDA advisory committee proceedings on MDMA-assisted therapy", journal: "NEJM", url: "#" },
          { title: "MDMA-assisted therapy for PTSD: 3.5-year follow-up safety data", journal: "J Psychopharmacol", url: "#" },
          { title: "International regulatory frameworks for psychedelic-assisted therapy", journal: "Lancet Psychiatry", url: "#" },
        ],
        followUps: [
          "What were the specific FDA concerns about MDMA therapy approval?",
          "How does MDMA-assisted therapy compare to prolonged exposure therapy?",
          "Are there biomarkers that predict response to MDMA-assisted therapy?",
        ],
      },
    ],
  },
];
