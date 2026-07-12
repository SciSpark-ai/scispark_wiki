export interface Paper {
  id: string;
  title: string;
  summary: string;
  journal: string;
  year: number;
  date: string;
  specialty: string;
  specialtyColor: string;
  badges: string[];
  tags: string[];
  evidenceRating: number;
  authors: string[];
  tldr: string;
  keyFindings: string[];
  paperUrl: string;
  liked: boolean;
  saved: boolean;
  readLater: boolean;
  originalTitle: string;       // Original academic paper title
  citations: number;           // Citation count
  laySummary: string;          // AI-generated lay person summary (2-3 sentences)
  originalAbstract: string;    // Original paper abstract
  figureDigest: {              // Figure analysis
    caption: string;           // e.g. "Figure 1"
    findings: string[];        // 3-4 bullet point descriptions
  } | null;
  breakpoints: {               // Key Breakpoints & Methods (5 items)
    label: string;             // e.g. "Research Question"
    content: string;           // The description text
    evidence: string;          // e.g. "Evidence: Objective, p.716"
  }[];
  relatedPapers: {             // 3 related papers
    title: string;
    journal: string;
    year: number;
  }[];
  dataLinks: {                 // Code and Data links
    code: string | null;       // URL or null
    data: string | null;       // Description or null
  };
}

export const SPECIALTY_COLORS: Record<string, string> = {
  Cardiology: "#ea580c",
  Psychiatry: "#6b7280",
  Oncology: "#d97706",
  Pediatrics: "#f59e0b",
  Neurology: "#4b5563",
  "Internal Medicine": "#059669",
  Other: "#94877c",
};

export const mockPapers: Paper[] = [
  {
    id: "paper-001",
    title:
      "Psilocybin-Assisted Therapy Achieves Rapid Remission in Treatment-Resistant Depression",
    summary:
      "This double-blind, randomized controlled trial enrolled 246 adults with treatment-resistant major depressive disorder (TRD), defined as failure of at least two adequate antidepressant trials. Participants were randomized 1:1 to a single supervised session of psilocybin 25 mg or active placebo (niacin 250 mg), each accompanied by structured preparatory and integration psychotherapy. The primary outcome was remission at week 8, defined as a Montgomery-Åsberg Depression Rating Scale (MADRS) score of 10 or below. Psilocybin produced a statistically significant improvement in remission rates (37.5% vs 12.3%; OR 4.26, 95% CI 2.18–8.31, p<0.001) and a mean between-group difference in MADRS change score of −14.2 points (95% CI −17.1 to −11.3).\n\nFunctional MRI substudies conducted at baseline and 24 hours post-session in a subset of 68 participants revealed significantly increased default mode network (DMN) entropy and reduced ego-dissolution-associated suppression of amygdala reactivity in responders relative to non-responders. These neurobiological signatures correlated with the magnitude of acute mystical experience, measured by the Mystical Experience Questionnaire (MEQ-30), suggesting that the psychological depth of the psilocybin experience mediates at least part of the antidepressant effect.\n\nSafety data showed that transient adverse effects — including anxiety (42%), visual phenomena (61%), and nausea (18%) — resolved within the supervised session window. No serious treatment-emergent adverse events were attributed to psilocybin. Remission was sustained at week 24 in 68% of initial week-8 responders, underscoring the durability of a single therapeutic dose. The trial provides the most rigorous evidence to date for psilocybin as a rapid-acting, durable intervention for TRD.",
    journal: "JAMA Psychiatry",
    year: 2025,
    date: "2025-03-11",
    specialty: "Psychiatry",
    specialtyColor: SPECIALTY_COLORS["Psychiatry"],
    badges: ["New This Week", "RCT"],
    tags: ["Psilocybin", "Treatment-Resistant Depression", "Psychedelic Therapy"],
    evidenceRating: 5,
    authors: ["Carhart-Harris RL", "Goodwin GM", "Nutt DJ"],
    tldr:
      "A single guided psilocybin session reduced MADRS scores by an additional 14 points over active placebo and achieved remission in 37.5% of patients with treatment-resistant depression at eight weeks. Neuroimaging linked response to increased default mode network entropy and acute mystical experience depth. Remission was maintained in 68% of initial responders at six months, supporting psilocybin as a durable, rapid-acting therapy for refractory mood disorders.",
    keyFindings: [
      "Psilocybin 25 mg produced remission (MADRS ≤10) in 37.5% of participants at week 8 versus 12.3% with active placebo (OR 4.26, 95% CI 2.18–8.31, p<0.001).",
      "Mean between-group MADRS change score favored psilocybin by 14.2 points (95% CI −17.1 to −11.3), exceeding the pre-specified minimally important clinical difference of 7 points.",
      "68% of week-8 responders maintained remission at week 24, with DMN entropy increases at 24 hours post-dose independently predicting sustained response (r=0.54, p<0.001).",
    ],
    paperUrl: "#",
    liked: false,
    saved: false,
    readLater: false,
    originalTitle:
      "Efficacy and Durability of Psilocybin-Assisted Psychotherapy in Adults with Treatment-Resistant Major Depressive Disorder: A Randomized, Double-Blind, Active Placebo-Controlled Trial with Neuroimaging Substudies",
    citations: 218,
    laySummary:
      "For people whose depression has not improved with at least two standard antidepressant medications, a single guided session using psilocybin — the active compound in psychedelic mushrooms — produced deep and lasting remission in more than a third of participants. Brain scans showed that psilocybin appears to 'loosen' rigid activity patterns in the brain regions associated with depressive rumination. Nearly seven in ten of those who responded were still in remission six months later, without any additional doses.",
    originalAbstract:
      "This double-blind, randomized controlled trial enrolled 246 adults with treatment-resistant major depressive disorder (TRD), defined as failure of at least two adequate antidepressant trials. Participants were randomized 1:1 to a single supervised session of psilocybin 25 mg or active placebo (niacin 250 mg), each accompanied by structured preparatory and integration psychotherapy. The primary outcome was remission at week 8, defined as a Montgomery-Åsberg Depression Rating Scale (MADRS) score of 10 or below. Psilocybin produced a statistically significant improvement in remission rates (37.5% vs 12.3%; OR 4.26, 95% CI 2.18–8.31, p<0.001) and a mean between-group difference in MADRS change score of −14.2 points (95% CI −17.1 to −11.3).\n\nFunctional MRI substudies conducted at baseline and 24 hours post-session in a subset of 68 participants revealed significantly increased default mode network (DMN) entropy and reduced ego-dissolution-associated suppression of amygdala reactivity in responders relative to non-responders. These neurobiological signatures correlated with the magnitude of acute mystical experience, measured by the Mystical Experience Questionnaire (MEQ-30), suggesting that the psychological depth of the psilocybin experience mediates at least part of the antidepressant effect.\n\nSafety data showed that transient adverse effects — including anxiety (42%), visual phenomena (61%), and nausea (18%) — resolved within the supervised session window. No serious treatment-emergent adverse events were attributed to psilocybin. Remission was sustained at week 24 in 68% of initial week-8 responders, underscoring the durability of a single therapeutic dose.",
    figureDigest: {
      caption: "Figure 1",
      findings: [
        "MADRS total score trajectories from baseline through week 24 show rapid divergence between psilocybin and niacin arms by week 1, widening to a between-group difference of 14.2 points at week 8 and maintained at 12.8 points at week 24.",
        "A waterfall plot of individual MADRS change scores at week 8 illustrates the broad distribution of large responses (>50% score reduction) in the psilocybin arm versus the tight near-zero cluster in the niacin arm.",
        "fMRI subgroup panel depicts default mode network entropy maps at 24 hours post-dose; responders show significantly greater posterior cingulate and medial prefrontal cortex entropy relative to non-responders (p<0.001, FDR-corrected).",
        "Scatter plot of MEQ-30 total score versus MADRS change at week 8 demonstrates a significant positive correlation (r=0.61, p<0.001), supporting acute mystical experience depth as a mediator of antidepressant response.",
      ],
    },
    breakpoints: [
      {
        label: "Research Question",
        content:
          "Does a single supervised session of psilocybin 25 mg combined with structured psychotherapy achieve superior remission rates compared to active placebo (niacin) in adults with treatment-resistant major depressive disorder at eight weeks?",
        evidence: "Evidence: Objectives, p.2",
      },
      {
        label: "Data & Sample",
        content:
          "246 adults aged 18–65 with TRD (≥2 failed adequate antidepressant trials), current MADRS ≥28, no psychotic or bipolar I history; enrolled across 14 academic centers in the UK and USA; median age 41 years; 54% female.",
        evidence: "Evidence: Participants & Eligibility, p.4–5",
      },
      {
        label: "Method Highlights",
        content:
          "Double-blind RCT; psilocybin 25 mg vs niacin 250 mg in a single supervised 6–8 hour session with two trained therapists; standardized preparatory sessions (3 × 60 min) and integration sessions (3 × 60 min); primary endpoint MADRS remission at week 8; fMRI substudy in 68 participants at 24 h post-dose.",
        evidence: "Evidence: Trial Design & Procedures, p.5–7, Figure S1",
      },
      {
        label: "Key Results",
        content:
          "Remission at week 8: 37.5% psilocybin vs 12.3% niacin (OR 4.26, p<0.001); MADRS change −14.2 points favoring psilocybin; 68% sustained remission at week 24; DMN entropy increase at 24 h correlated with week-8 response (r=0.54, p<0.001).",
        evidence: "Evidence: Results, p.8–12, Tables 2–3",
      },
      {
        label: "Implications & Limitations",
        content:
          "Findings support psilocybin as a rapid-acting and durable intervention for TRD; blinding integrity was imperfect given subjective psilocybin effects; generalizability to older adults and those with comorbid anxiety disorders is uncertain; longer-term safety beyond 6 months has not been established.",
        evidence: "Evidence: Discussion & Limitations, p.14–16",
      },
    ],
    relatedPapers: [
      {
        title:
          "Psilocybin versus Escitalopram for Depression (COMPASS Pathways Phase IIb Trial)",
        journal: "New England Journal of Medicine",
        year: 2021,
      },
      {
        title:
          "Single-Dose Psilocybin for a Treatment-Resistant Episode of Major Depression",
        journal: "New England Journal of Medicine",
        year: 2023,
      },
      {
        title:
          "Neural Correlates of the Psychedelic State as Determined by fMRI Studies with Psilocybin",
        journal: "PNAS",
        year: 2012,
      },
    ],
    dataLinks: {
      code: "https://github.com/carhart-harris-lab/psilocybin-trd-2025",
      data: "Individual participant data available through the UK Data Service upon approved researcher application (study reference: SN-855312).",
    },
  },
  {
    id: "paper-002",
    title:
      "Deep Brain Stimulation of the Subcallosal Cingulate for Refractory Major Depression",
    summary:
      "This multicenter, double-blind, sham-controlled phase III trial examined deep brain stimulation (DBS) targeting the subcallosal cingulate cortex (SCC; area 25) in 128 patients with refractory major depressive disorder (MDD) who had failed at least four adequate treatments including pharmacotherapy, psychotherapy, and electroconvulsive therapy. Patients were implanted with rechargeable DBS devices and randomized 1:1 to active or sham stimulation for 26 weeks before all entering an open-label active phase. The primary endpoint was response at week 26, defined as a ≥50% reduction in Hamilton Depression Rating Scale-17 (HAM-D17) score. Active DBS achieved response in 47.7% of participants versus 17.2% in the sham arm (p<0.001), with a mean HAM-D17 reduction of 11.4 points (95% CI 8.1–14.7).\n\nIndividualized tractography-guided targeting using diffusion-weighted MRI to identify the optimal white matter tract bundle — specifically the forceps minor and medial forebrain bundle — was associated with a 19-percentage-point higher response rate compared to anatomically guided targeting alone, highlighting the importance of precision neuromodulation. Resting-state fMRI demonstrated that successful SCC-DBS normalized hyperconnectivity between the subgenual anterior cingulate cortex and the amygdala, a circuit implicated in negative affect and anhedonia.\n\nSerious adverse events included one device-related infection (1.6%), two lead migrations requiring repositioning (3.1%), and no stimulation-related suicidality. Sustained remission was achieved in 31.3% of active DBS participants at 12 months following the open-label extension. These findings establish tractography-guided SCC-DBS as an effective and acceptably safe intervention for the most severe, refractory cases of MDD.",
    journal: "Nature Medicine",
    year: 2025,
    date: "2025-01-22",
    specialty: "Neurology",
    specialtyColor: SPECIALTY_COLORS["Neurology"],
    badges: ["RCT", "New This Week"],
    tags: ["Deep Brain Stimulation", "Refractory Depression", "Neuromodulation"],
    evidenceRating: 4,
    authors: ["Lozano AM", "Mayberg HS", "Kennedy SH"],
    tldr:
      "Tractography-guided deep brain stimulation of the subcallosal cingulate cortex achieved response rates of 47.7% versus 17.2% with sham stimulation in patients with refractory MDD after 26 weeks. Individualized white matter tract targeting improved outcomes by 19 percentage points over anatomical targeting, and successful stimulation normalized amygdala–subgenual cingulate hyperconnectivity. Sustained remission at 12 months reached 31.3%, supporting SCC-DBS as a viable last-resort intervention for the most treatment-refractory patients.",
    keyFindings: [
      "Active SCC-DBS achieved HAM-D17 response (≥50% reduction) in 47.7% of participants at week 26 versus 17.2% with sham stimulation (OR 4.44, 95% CI 1.92–10.26, p<0.001).",
      "Tractography-guided targeting improved response rates by 19 percentage points over anatomical targeting alone (55.6% vs 36.7%), establishing precision neuronavigation as a key determinant of outcome.",
      "Sustained remission (HAM-D17 ≤7) was achieved in 31.3% of active-arm patients at 12-month follow-up, with resting-state fMRI confirming normalization of subgenual cingulate–amygdala hyperconnectivity in responders.",
    ],
    paperUrl: "#",
    liked: false,
    saved: false,
    readLater: false,
    originalTitle:
      "Tractography-Guided Deep Brain Stimulation of the Subcallosal Cingulate Cortex for Refractory Major Depressive Disorder: A Multicenter, Double-Blind, Sham-Controlled Phase III Trial",
    citations: 143,
    laySummary:
      "Some people with severe depression do not improve despite trying multiple medications, therapy, and even electroconvulsive therapy. This trial tested a brain pacemaker surgically implanted near a key emotional hub in the brain and found that nearly half of patients showed major improvement after six months of stimulation — far better than the sham device. Using individual brain scan data to guide exactly where to place the device made outcomes significantly better, pointing the way toward a more personalized approach to this last-resort treatment.",
    originalAbstract:
      "This multicenter, double-blind, sham-controlled phase III trial examined deep brain stimulation (DBS) targeting the subcallosal cingulate cortex (SCC; area 25) in 128 patients with refractory major depressive disorder (MDD) who had failed at least four adequate treatments including pharmacotherapy, psychotherapy, and electroconvulsive therapy. Patients were implanted with rechargeable DBS devices and randomized 1:1 to active or sham stimulation for 26 weeks before all entering an open-label active phase. The primary endpoint was response at week 26, defined as a ≥50% reduction in Hamilton Depression Rating Scale-17 (HAM-D17) score. Active DBS achieved response in 47.7% of participants versus 17.2% in the sham arm (p<0.001), with a mean HAM-D17 reduction of 11.4 points (95% CI 8.1–14.7).\n\nIndividualized tractography-guided targeting using diffusion-weighted MRI to identify the optimal white matter tract bundle — specifically the forceps minor and medial forebrain bundle — was associated with a 19-percentage-point higher response rate compared to anatomically guided targeting alone, highlighting the importance of precision neuromodulation. Resting-state fMRI demonstrated that successful SCC-DBS normalized hyperconnectivity between the subgenual anterior cingulate cortex and the amygdala, a circuit implicated in negative affect and anhedonia.\n\nSerious adverse events included one device-related infection (1.6%), two lead migrations requiring repositioning (3.1%), and no stimulation-related suicidality. Sustained remission was achieved in 31.3% of active DBS participants at 12 months following the open-label extension.",
    figureDigest: {
      caption: "Figure 1",
      findings: [
        "HAM-D17 total score trajectories from implantation through week 52 show active DBS diverging from sham by week 4, with the between-group gap reaching 11.4 points at week 26 and maintained through the 12-month open-label extension.",
        "3D tractography reconstruction overlaid on a standard MNI brain template illustrates the optimal stimulation sweet spot within the subcallosal white matter bundle; patients with electrode contacts within this zone had 19-percentage-point higher response rates.",
        "Resting-state fMRI functional connectivity matrices at baseline and week 26 depict the normalization of subgenual cingulate–amygdala hyperconnectivity in responders, contrasted with persistent abnormal connectivity in non-responders.",
        "Forest plot of subgroup analyses (age, sex, prior ECT, illness duration) demonstrates consistent response benefit favoring active DBS across all pre-specified subgroups, with no significant treatment-by-subgroup interactions.",
      ],
    },
    breakpoints: [
      {
        label: "Research Question",
        content:
          "Does tractography-guided deep brain stimulation of the subcallosal cingulate cortex (area 25) produce superior antidepressant response at 26 weeks compared to sham stimulation in patients with refractory MDD who have failed at least four prior treatments?",
        evidence: "Evidence: Objectives, p.2",
      },
      {
        label: "Data & Sample",
        content:
          "128 adults aged 22–68 with refractory MDD (≥4 failed treatments; illness duration ≥5 years; HAM-D17 ≥20); enrolled at 8 academic centers in Canada and USA; 58% female; median prior treatment trials: 6; median illness duration: 11.3 years.",
        evidence: "Evidence: Eligibility & Enrollment, p.4–5",
      },
      {
        label: "Method Highlights",
        content:
          "Double-blind sham-controlled RCT; bilateral SCC-DBS with rechargeable Medtronic Percept PC devices; tractography-guided vs anatomical targeting in parallel cohorts; 26-week blinded phase followed by 26-week open-label active extension; primary endpoint HAM-D17 response at week 26; resting-state fMRI substudy at baseline, week 12, and week 26.",
        evidence: "Evidence: Design & Procedures, p.5–8, Figure S2",
      },
      {
        label: "Key Results",
        content:
          "HAM-D17 response at week 26: 47.7% active vs 17.2% sham (OR 4.44, p<0.001); tractography-guided targeting: 55.6% vs 36.7% response (anatomical); 12-month remission 31.3%; amygdala–sgACC hyperconnectivity normalized in 74% of responders.",
        evidence: "Evidence: Efficacy & Neuroimaging Results, p.9–13, Tables 2–4",
      },
      {
        label: "Implications & Limitations",
        content:
          "Establishes SCC-DBS with tractography guidance as an effective last-resort intervention for severe TRD; small sample size limits definitive biomarker analysis; surgery and long-term device maintenance create access barriers; placebo effects of sham surgery may contribute to the sham response rate; longer-term stimulation-related risks require continued surveillance.",
        evidence: "Evidence: Discussion & Limitations, p.15–17",
      },
    ],
    relatedPapers: [
      {
        title:
          "Subcallosal Cingulate Deep Brain Stimulation for Treatment-Resistant Depression: A Multisite, Randomised Controlled Trial",
        journal: "The Lancet",
        year: 2022,
      },
      {
        title:
          "Optimizing Deep Brain Stimulation Parameters and Target Sites for Treatment-Resistant Depression",
        journal: "JAMA Neurology",
        year: 2020,
      },
      {
        title:
          "White Matter Pathways for Deep Brain Stimulation in Major Depression: A Review of the Evidence",
        journal: "Brain Stimulation",
        year: 2023,
      },
    ],
    dataLinks: {
      code: "https://github.com/lozano-lab/scc-dbs-tractography",
      data: "De-identified imaging and clinical data deposited in the OpenNeuro repository (accession ds004812) under a controlled-access data sharing agreement.",
    },
  },
  {
    id: "paper-003",
    title:
      "Ketamine vs Esketamine for Acute Suicidal Ideation in Emergency Settings",
    summary:
      "This multicenter, open-label, randomized non-inferiority trial compared intravenous racemic ketamine (0.5 mg/kg over 40 min) with intranasal esketamine (84 mg; two devices) for the rapid reduction of acute suicidal ideation in 312 adults presenting to emergency departments. The primary endpoint was the Columbia Suicide Severity Rating Scale (C-SSRS) ideation intensity score at 4 hours post-administration, with a pre-specified non-inferiority margin of 2 points. Both agents produced rapid and clinically meaningful reductions in suicidal ideation; the mean C-SSRS reduction was 8.1 points (SD 3.4) in the ketamine arm and 7.6 points (SD 3.7) in the esketamine arm (adjusted difference 0.5 points, 95% CI −0.4 to 1.4), meeting the non-inferiority criterion.\n\nSecondary outcomes included remission of suicidal ideation (C-SSRS ideation score ≤1) at 4 hours, time to patient disposition from the emergency department, and 7-day and 30-day suicidal ideation recurrence. Remission at 4 hours was achieved in 58.3% of the ketamine group and 54.5% of the esketamine group (difference 3.8%, 95% CI −5.4 to 13.0). Intranasal administration was associated with significantly shorter nurse preparation time (4.1 vs 18.6 minutes) and reduced need for IV access, potentially improving workflow in resource-constrained emergency settings.\n\nDissociative side effects were common in both groups but transient, with peak dissociation scores on the Clinician-Administered Dissociative States Scale (CADSS) resolving to near-baseline within 90 minutes. Thirty-day re-presentation rates for suicidal crisis did not differ significantly between arms (18.4% ketamine vs 20.1% esketamine, p=0.67). These findings suggest that intranasal esketamine represents a practical and non-inferior alternative to IV ketamine for acute emergency management of suicidal ideation.",
    journal: "The Lancet Psychiatry",
    year: 2025,
    date: "2025-02-18",
    specialty: "Psychiatry",
    specialtyColor: SPECIALTY_COLORS["Psychiatry"],
    badges: ["RCT", "New This Week"],
    tags: ["Ketamine", "Suicidal Ideation", "Emergency Psychiatry"],
    evidenceRating: 4,
    authors: ["Murrough JW", "Iosifescu DV", "Feder A"],
    tldr:
      "In 312 adults presenting to the emergency department with acute suicidal ideation, intranasal esketamine was non-inferior to intravenous ketamine on C-SSRS ideation reduction at 4 hours, with remission rates of 54.5% versus 58.3%. Intranasal administration reduced nurse preparation time by 14 minutes, offering a meaningful workflow advantage in emergency settings. Thirty-day suicidal re-presentation rates were comparable between groups at approximately 19–20%.",
    keyFindings: [
      "Intranasal esketamine met the non-inferiority criterion for C-SSRS reduction at 4 hours (adjusted difference 0.5 points, 95% CI −0.4 to 1.4), with remission rates of 54.5% vs 58.3% for IV ketamine.",
      "Intranasal esketamine reduced nurse preparation time from 18.6 to 4.1 minutes and eliminated IV access requirements, significantly improving emergency department workflow (p<0.001 for preparation time).",
      "Dissociative side effects peaked at 40 minutes post-administration (mean CADSS score 18.3 vs 21.7) and resolved to near-baseline in both groups within 90 minutes, with no clinically meaningful between-group safety differences.",
    ],
    paperUrl: "#",
    liked: false,
    saved: false,
    readLater: false,
    originalTitle:
      "Intravenous Racemic Ketamine Versus Intranasal Esketamine for Rapid Reduction of Acute Suicidal Ideation in Emergency Department Patients: A Multicenter, Open-Label, Randomized Non-Inferiority Trial",
    citations: 87,
    laySummary:
      "Both a nasal spray version of ketamine (esketamine) and a ketamine infusion into a vein worked equally well at rapidly reducing suicidal thoughts in people arriving at emergency departments in crisis. The nasal spray version was much simpler to administer and could be given without inserting an IV line, making it easier for busy emergency wards. Around 55–58% of patients in both groups had their suicidal thoughts almost completely resolved within four hours of treatment.",
    originalAbstract:
      "This multicenter, open-label, randomized non-inferiority trial compared intravenous racemic ketamine (0.5 mg/kg over 40 min) with intranasal esketamine (84 mg; two devices) for the rapid reduction of acute suicidal ideation in 312 adults presenting to emergency departments. The primary endpoint was the Columbia Suicide Severity Rating Scale (C-SSRS) ideation intensity score at 4 hours post-administration, with a pre-specified non-inferiority margin of 2 points. Both agents produced rapid and clinically meaningful reductions in suicidal ideation; the mean C-SSRS reduction was 8.1 points (SD 3.4) in the ketamine arm and 7.6 points (SD 3.7) in the esketamine arm (adjusted difference 0.5 points, 95% CI −0.4 to 1.4), meeting the non-inferiority criterion.\n\nSecondary outcomes included remission of suicidal ideation (C-SSRS ideation score ≤1) at 4 hours, time to patient disposition from the emergency department, and 7-day and 30-day suicidal ideation recurrence. Remission at 4 hours was achieved in 58.3% of the ketamine group and 54.5% of the esketamine group (difference 3.8%, 95% CI −5.4 to 13.0). Intranasal administration was associated with significantly shorter nurse preparation time (4.1 vs 18.6 minutes) and reduced need for IV access, potentially improving workflow in resource-constrained emergency settings.\n\nDissociative side effects were common in both groups but transient, with peak dissociation scores on the Clinician-Administered Dissociative States Scale (CADSS) resolving to near-baseline within 90 minutes. Thirty-day re-presentation rates for suicidal crisis did not differ significantly between arms (18.4% ketamine vs 20.1% esketamine, p=0.67).",
    figureDigest: {
      caption: "Figure 1",
      findings: [
        "Non-inferiority margin plot displays the adjusted mean difference in C-SSRS reduction (0.5 points, 95% CI −0.4 to 1.4) with the pre-specified 2-point non-inferiority boundary clearly illustrated; the entire confidence interval lies within the non-inferiority zone.",
        "Time-course curves for mean C-SSRS ideation intensity scores from baseline through 4 hours show near-identical trajectories for both ketamine and esketamine, with the greatest rate of decline occurring within the first 60 minutes.",
        "CADSS dissociation score time-course from 0 to 240 minutes demonstrates parallel trajectories for both agents, with peak scores at 40 minutes (21.7 ketamine vs 18.3 esketamine) and near-baseline resolution by 90 minutes.",
        "30-day Kaplan-Meier curves for suicidal ideation recurrence show overlapping event rates (18.4% vs 20.1%), confirming no significant difference in medium-term relapse risk (log-rank p=0.67).",
      ],
    },
    breakpoints: [
      {
        label: "Research Question",
        content:
          "Is intranasal esketamine 84 mg non-inferior to intravenous racemic ketamine 0.5 mg/kg for reducing acute suicidal ideation at 4 hours in adults presenting to emergency departments, using a non-inferiority margin of 2 points on the C-SSRS ideation intensity scale?",
        evidence: "Evidence: Objectives & Hypotheses, p.2–3",
      },
      {
        label: "Data & Sample",
        content:
          "312 adults aged 18–70 presenting to emergency departments with active suicidal ideation (C-SSRS ideation score ≥3), no active psychosis, and no contraindication to ketamine; enrolled across 11 academic emergency centers in the USA and Canada; median age 34 years; 52% female; 43% with prior suicide attempt history.",
        evidence: "Evidence: Eligibility & Recruitment, p.4–5",
      },
      {
        label: "Method Highlights",
        content:
          "Open-label, parallel-group randomized non-inferiority trial; IV ketamine 0.5 mg/kg over 40 min vs intranasal esketamine 84 mg (2 × 28 mg devices per nostril); C-SSRS assessed by blinded rater at 0, 1, 2, and 4 hours; nurse preparation time log as secondary workflow endpoint; 30-day follow-up via telephone and EMR review.",
        evidence: "Evidence: Study Design & Procedures, p.5–7",
      },
      {
        label: "Key Results",
        content:
          "C-SSRS reduction: 8.1 pts ketamine vs 7.6 pts esketamine (adjusted difference 0.5, 95% CI −0.4 to 1.4; non-inferior); remission at 4 h: 58.3% vs 54.5%; nurse preparation time: 18.6 vs 4.1 min (p<0.001); 30-day re-presentation: 18.4% vs 20.1% (p=0.67).",
        evidence: "Evidence: Efficacy & Workflow Results, p.8–12, Tables 2–3",
      },
      {
        label: "Implications & Limitations",
        content:
          "Intranasal esketamine offers a practical, non-inferior alternative to IV ketamine for acute suicidal ideation management in emergency settings; open-label design may have influenced subjective endpoints; 30-day follow-up is insufficient to assess longer-term suicidal behavior outcomes; neither intervention addressed the underlying psychiatric diagnosis.",
        evidence: "Evidence: Discussion & Limitations, p.13–16",
      },
    ],
    relatedPapers: [
      {
        title:
          "Ketamine for Rapid Reduction of Suicidal Ideation: A Randomized Controlled Trial",
        journal: "Psychological Medicine",
        year: 2018,
      },
      {
        title:
          "Intranasal Esketamine (Spravato) for Treatment-Resistant Depression with Acute Suicidal Ideation or Behavior",
        journal: "JAMA Psychiatry",
        year: 2020,
      },
      {
        title:
          "NMDA Receptor Antagonism and Suicidal Ideation: Mechanisms and Clinical Implications",
        journal: "Neuropsychopharmacology",
        year: 2022,
      },
    ],
    dataLinks: {
      code: null,
      data: "De-identified patient-level data available through the National Institute of Mental Health Data Archive (NDA collection: 2891) upon approved data use agreement.",
    },
  },
  {
    id: "paper-004",
    title:
      "Gut-Brain Axis Modulation Through Probiotic Supplementation in Generalized Anxiety Disorder",
    summary:
      "This 12-week, double-blind, placebo-controlled randomized trial assessed the efficacy of a multi-strain probiotic formulation (Lactobacillus rhamnosus GG, Bifidobacterium longum, and Lactobacillus helveticus; 1×10¹⁰ CFU/day) versus matched placebo in 180 adults with DSM-5 generalized anxiety disorder (GAD) not currently receiving pharmacotherapy. The primary endpoint was change in Generalized Anxiety Disorder 7-item scale (GAD-7) score from baseline to week 12. Probiotic supplementation reduced GAD-7 scores by a mean of 5.4 points (SD 3.1) versus 2.8 points (SD 2.9) with placebo (adjusted difference −2.6, 95% CI −3.4 to −1.8, p<0.001), with 41.1% of the probiotic group meeting response criteria (≥50% GAD-7 reduction) versus 20.0% on placebo.\n\nMicrobiome analysis using 16S rRNA gene sequencing demonstrated significant increases in alpha diversity and relative abundance of Faecalibacterium prausnitzii and Akkermansia muciniphila in the probiotic arm, which correlated positively with GAD-7 reduction (r=0.47, p<0.001). Serum cortisol area under the curve (AUC) following a standardized Trier Social Stress Test was significantly lower in the probiotic arm at week 12 (−18.3 nmol/L·min, 95% CI −24.1 to −12.5, p<0.001), as was fasting plasma interleukin-6 (−1.2 pg/mL, p=0.003), consistent with downregulation of the hypothalamic–pituitary–adrenal (HPA) axis and systemic inflammation.\n\nProbiotic supplementation was well tolerated, with transient bloating the only adverse effect occurring more frequently than placebo (11.1% vs 4.4%, p=0.08). Quality of life, measured by the SF-36 mental component summary score, improved by 8.7 points more in the probiotic group than placebo (p<0.001). These findings provide controlled evidence that targeted microbiome modulation through probiotic supplementation attenuates the gut-brain axis dysregulation underlying GAD.",
    journal: "Biological Psychiatry",
    year: 2024,
    date: "2024-11-07",
    specialty: "Psychiatry",
    specialtyColor: SPECIALTY_COLORS["Psychiatry"],
    badges: ["RCT"],
    tags: ["Gut-Brain Axis", "Generalized Anxiety Disorder", "Probiotics"],
    evidenceRating: 3,
    authors: ["Dinan TG", "Cryan JF", "Clarke G"],
    tldr:
      "A 12-week multi-strain probiotic supplement reduced GAD-7 anxiety scores by an additional 2.6 points over placebo and achieved response in 41% of adults with generalized anxiety disorder, alongside reductions in cortisol stress reactivity and IL-6. Microbiome changes — specifically increased Faecalibacterium prausnitzii abundance — correlated strongly with clinical improvement. These findings provide the first adequately powered RCT evidence for microbiome-targeted therapy as an adjunctive approach to GAD.",
    keyFindings: [
      "Multi-strain probiotic supplementation reduced GAD-7 scores by 5.4 points versus 2.8 points with placebo at 12 weeks (adjusted difference −2.6, 95% CI −3.4 to −1.8, p<0.001), with response rates of 41.1% vs 20.0%.",
      "Cortisol AUC following psychosocial stress was reduced by 18.3 nmol/L·min in the probiotic arm at week 12 (p<0.001), and fasting IL-6 declined by 1.2 pg/mL (p=0.003), indicating HPA axis and inflammatory modulation.",
      "Increased relative abundance of Faecalibacterium prausnitzii at week 12 correlated with GAD-7 score reduction (r=0.47, p<0.001), identifying this butyrate-producing taxon as a candidate biomarker of gut-brain anxiolytic response.",
    ],
    paperUrl: "#",
    liked: false,
    saved: false,
    readLater: false,
    originalTitle:
      "Multi-Strain Probiotic Supplementation and Gut-Brain Axis Modulation in Adults with Generalized Anxiety Disorder: A 12-Week, Double-Blind, Placebo-Controlled Randomized Trial with Microbiome and Neuroendocrine Substudies",
    citations: 64,
    laySummary:
      "A 12-week course of a multi-strain probiotic supplement meaningfully reduced anxiety symptoms in adults with generalized anxiety disorder compared to a placebo pill, with over 40% of probiotic users showing a clinically significant improvement. People taking the probiotic also had lower stress hormone levels when put through a standardized stress test, and their gut bacteria became more diverse in ways associated with better mental health. This trial suggests that improving gut health through probiotics may be a practical add-on strategy for managing anxiety.",
    originalAbstract:
      "This 12-week, double-blind, placebo-controlled randomized trial assessed the efficacy of a multi-strain probiotic formulation (Lactobacillus rhamnosus GG, Bifidobacterium longum, and Lactobacillus helveticus; 1×10¹⁰ CFU/day) versus matched placebo in 180 adults with DSM-5 generalized anxiety disorder (GAD) not currently receiving pharmacotherapy. The primary endpoint was change in Generalized Anxiety Disorder 7-item scale (GAD-7) score from baseline to week 12. Probiotic supplementation reduced GAD-7 scores by a mean of 5.4 points (SD 3.1) versus 2.8 points (SD 2.9) with placebo (adjusted difference −2.6, 95% CI −3.4 to −1.8, p<0.001), with 41.1% of the probiotic group meeting response criteria (≥50% GAD-7 reduction) versus 20.0% on placebo.\n\nMicrobiome analysis using 16S rRNA gene sequencing demonstrated significant increases in alpha diversity and relative abundance of Faecalibacterium prausnitzii and Akkermansia muciniphila in the probiotic arm, which correlated positively with GAD-7 reduction (r=0.47, p<0.001). Serum cortisol area under the curve (AUC) following a standardized Trier Social Stress Test was significantly lower in the probiotic arm at week 12 (−18.3 nmol/L·min, 95% CI −24.1 to −12.5, p<0.001), as was fasting plasma interleukin-6 (−1.2 pg/mL, p=0.003), consistent with downregulation of the HPA axis and systemic inflammation.\n\nProbiotic supplementation was well tolerated, with transient bloating the only adverse effect occurring more frequently than placebo (11.1% vs 4.4%, p=0.08). Quality of life, measured by the SF-36 mental component summary score, improved by 8.7 points more in the probiotic group than placebo (p<0.001).",
    figureDigest: {
      caption: "Figure 1",
      findings: [
        "GAD-7 score trajectories from baseline to week 12 show progressive divergence between probiotic and placebo arms, with a statistically significant difference emerging at week 4 and widening to an adjusted difference of 2.6 points at week 12.",
        "Microbiome alpha-diversity (Shannon index) and Faecalibacterium prausnitzii relative abundance at baseline, week 6, and week 12 show significant increases in the probiotic arm; a scatter plot overlaid on the week-12 panel demonstrates the correlation with GAD-7 change (r=0.47).",
        "Cortisol AUC bar charts from the Trier Social Stress Test at baseline and week 12 illustrate an 18.3 nmol/L·min reduction in the probiotic arm, significantly greater than the 3.1 nmol/L·min reduction in placebo (p<0.001).",
        "Response and remission rate comparison (week 12) shows probiotic vs placebo rates of 41.1% vs 20.0% for response and 22.2% vs 8.9% for remission (GAD-7 <5), with both differences statistically significant.",
      ],
    },
    breakpoints: [
      {
        label: "Research Question",
        content:
          "Does a 12-week course of multi-strain probiotic supplementation (Lactobacillus rhamnosus GG, Bifidobacterium longum, Lactobacillus helveticus) reduce anxiety symptom severity compared to placebo in adults with DSM-5 generalized anxiety disorder?",
        evidence: "Evidence: Objectives, p.2",
      },
      {
        label: "Data & Sample",
        content:
          "180 adults aged 18–65 with DSM-5 GAD (GAD-7 ≥10) not receiving current pharmacotherapy for anxiety; excluded: irritable bowel syndrome, antibiotic use in prior 3 months, immunosuppression; enrolled across 4 academic psychiatric clinics in Ireland; median age 33 years; 61% female.",
        evidence: "Evidence: Eligibility & Participants, p.4–5",
      },
      {
        label: "Method Highlights",
        content:
          "Double-blind, placebo-controlled RCT; once-daily probiotic capsule (1×10¹⁰ CFU) vs matched placebo for 12 weeks; 16S rRNA microbiome sequencing at baseline, week 6, and week 12; Trier Social Stress Test with cortisol AUC at baseline and week 12; primary endpoint GAD-7 change at week 12.",
        evidence: "Evidence: Methods & Procedures, p.5–8",
      },
      {
        label: "Key Results",
        content:
          "GAD-7 reduction: 5.4 pts probiotic vs 2.8 pts placebo (adjusted difference −2.6, p<0.001); response 41.1% vs 20.0%; cortisol AUC reduction −18.3 nmol/L·min (p<0.001); IL-6 −1.2 pg/mL (p=0.003); F. prausnitzii abundance correlated with GAD-7 reduction (r=0.47).",
        evidence: "Evidence: Results, p.8–13, Tables 2–4",
      },
      {
        label: "Implications & Limitations",
        content:
          "Provides controlled evidence for gut-brain axis modulation as a therapeutic target in GAD; effect size (Cohen's d ≈0.44) is modest and below most established pharmacological benchmarks; the trial excluded participants on pharmacotherapy, limiting generalizability; microbiome findings are associative, not causal; long-term durability beyond 12 weeks not established.",
        evidence: "Evidence: Discussion & Limitations, p.14–17",
      },
    ],
    relatedPapers: [
      {
        title:
          "Psychobiotics and the Gut-Brain Axis: In the Pursuit of Happiness",
        journal: "Neuropsychobiology",
        year: 2020,
      },
      {
        title:
          "Microbiota and the Social Brain: The Gut-Brain Axis in Anxiety and Depression",
        journal: "Science",
        year: 2019,
      },
      {
        title:
          "A Randomized Controlled Trial of a Probiotic Combination in 70 Adults with Major Depression",
        journal: "Nutritional Neuroscience",
        year: 2021,
      },
    ],
    dataLinks: {
      code: "https://github.com/dinan-cryan-lab/gut-brain-gad-2024",
      data: "Microbiome 16S rRNA sequencing data deposited in the European Nucleotide Archive (accession PRJEB61023); clinical data available on reasonable request to the corresponding author.",
    },
  },
  {
    id: "paper-005",
    title:
      "Transcranial Magnetic Stimulation Protocol Optimization for Obsessive-Compulsive Disorder",
    summary:
      "This three-arm, double-blind, sham-controlled randomized trial compared two active repetitive transcranial magnetic stimulation (rTMS) protocols — deep TMS (dTMS) targeting the anterior cingulate cortex (ACC) and high-frequency rTMS (HF-rTMS) targeting the supplementary motor area (SMA) — against sham stimulation in 216 adults with DSM-5 OCD refractory to at least two serotonin reuptake inhibitor trials. Patients received 30 daily sessions over six weeks. The primary endpoint was response at week 6, defined as ≥35% reduction in Yale-Brown Obsessive Compulsive Scale (Y-BOCS-II) score. Response rates were 46.5% for dTMS-ACC, 38.9% for HF-rTMS-SMA, and 14.1% for sham (p<0.001 for both active arms vs sham).\n\nDose-response analyses revealed that sessions 16–30 contributed disproportionately to symptom improvement relative to sessions 1–15, suggesting a cumulative facilitation effect that may require extended protocols compared to those used in depression. Resting-state EEG connectivity analyses indicated that pre-treatment elevated theta-band cortico-striatal coherence in the OFC-caudate circuit predicted non-response to rTMS (AUC 0.74, 95% CI 0.64–0.84), offering a potential biomarker for patient selection. Follow-up at 3 months post-treatment showed that dTMS-ACC responders maintained ≥35% Y-BOCS-II reduction in 61.9% of cases, compared to 44.4% for HF-rTMS-SMA responders.\n\nAdverse events were mild and comparable across active arms; headache (22–26%) and scalp discomfort (17–21%) were the most frequent treatment-emergent events. No seizures occurred. These findings support dTMS of the ACC as the superior rTMS approach for OCD and highlight cortico-striatal EEG biomarkers as a clinically actionable tool for treatment selection.",
    journal: "Brain Stimulation",
    year: 2025,
    date: "2025-01-14",
    specialty: "Neurology",
    specialtyColor: SPECIALTY_COLORS["Neurology"],
    badges: ["RCT"],
    tags: ["TMS", "OCD", "Neuromodulation"],
    evidenceRating: 4,
    authors: ["Tendler A", "Roth Y", "Zangen A"],
    tldr:
      "Deep TMS targeting the anterior cingulate cortex achieved response in 46.5% of OCD patients at six weeks, significantly outperforming both SMA-targeted rTMS (38.9%) and sham (14.1%). Pre-treatment OFC-caudate theta coherence predicted non-response with an AUC of 0.74, providing a candidate EEG biomarker for patient selection. Durability at 3 months was better for dTMS-ACC (61.9% maintained response) than HF-rTMS-SMA (44.4%), supporting ACC-dTMS as the preferred neuromodulation protocol for refractory OCD.",
    keyFindings: [
      "Deep TMS targeting the ACC achieved Y-BOCS-II response (≥35% reduction) in 46.5% of patients at week 6 versus 38.9% for SMA-rTMS and 14.1% for sham (OR vs sham: dTMS 5.26, 95% CI 2.44–11.35; HF-rTMS 3.82, 95% CI 1.77–8.26; both p<0.001).",
      "Pre-treatment OFC-caudate theta-band coherence on resting-state EEG predicted rTMS non-response with an AUC of 0.74 (95% CI 0.64–0.84), a sensitivity of 68%, and a specificity of 72%, identifying a novel patient selection biomarker.",
      "Response durability at 3 months post-treatment was significantly higher for dTMS-ACC (61.9%) than HF-rTMS-SMA (44.4%, p=0.048), with symptom re-emergence concentrated in the first 6 weeks post-cessation.",
    ],
    paperUrl: "#",
    liked: false,
    saved: false,
    readLater: false,
    originalTitle:
      "Deep Transcranial Magnetic Stimulation of the Anterior Cingulate Cortex Versus High-Frequency rTMS of the Supplementary Motor Area Versus Sham for Treatment-Resistant Obsessive-Compulsive Disorder: A Three-Arm, Double-Blind, Randomized Controlled Trial with EEG Biomarker Substudies",
    citations: 76,
    laySummary:
      "Magnetic brain stimulation delivered daily over six weeks produced meaningful symptom reduction in nearly half of OCD patients who had not responded to medication. Targeting a deep frontal brain region called the anterior cingulate cortex worked better than targeting a motor area, and nearly two-thirds of responders maintained their improvement three months later. A brain wave measurement taken before treatment could predict who was unlikely to respond, which could eventually help doctors choose the best treatment option for each patient.",
    originalAbstract:
      "This three-arm, double-blind, sham-controlled randomized trial compared two active repetitive transcranial magnetic stimulation (rTMS) protocols — deep TMS (dTMS) targeting the anterior cingulate cortex (ACC) and high-frequency rTMS (HF-rTMS) targeting the supplementary motor area (SMA) — against sham stimulation in 216 adults with DSM-5 OCD refractory to at least two serotonin reuptake inhibitor trials. Patients received 30 daily sessions over six weeks. The primary endpoint was response at week 6, defined as ≥35% reduction in Yale-Brown Obsessive Compulsive Scale (Y-BOCS-II) score. Response rates were 46.5% for dTMS-ACC, 38.9% for HF-rTMS-SMA, and 14.1% for sham (p<0.001 for both active arms vs sham).\n\nDose-response analyses revealed that sessions 16–30 contributed disproportionately to symptom improvement relative to sessions 1–15, suggesting a cumulative facilitation effect that may require extended protocols compared to those used in depression. Resting-state EEG connectivity analyses indicated that pre-treatment elevated theta-band cortico-striatal coherence in the OFC-caudate circuit predicted non-response to rTMS (AUC 0.74, 95% CI 0.64–0.84), offering a potential biomarker for patient selection.\n\nAdverse events were mild and comparable across active arms; headache (22–26%) and scalp discomfort (17–21%) were the most frequent treatment-emergent events. No seizures occurred. These findings support dTMS of the ACC as the superior rTMS approach for OCD and highlight cortico-striatal EEG biomarkers as a clinically actionable tool for treatment selection.",
    figureDigest: {
      caption: "Figure 1",
      findings: [
        "Y-BOCS-II total score trajectories across 6 weeks for dTMS-ACC, HF-rTMS-SMA, and sham arms show progressive divergence beginning at week 2; dTMS-ACC demonstrates the steepest slope between weeks 3 and 6, consistent with cumulative facilitation.",
        "Session-by-session dose-response analysis (sessions 1–30) illustrates that 58% of the total symptom improvement in the dTMS-ACC arm occurred during sessions 16–30, supporting extended treatment protocols for OCD relative to standard MDD protocols.",
        "ROC curve for OFC-caudate theta coherence as a predictor of rTMS non-response demonstrates an AUC of 0.74 (95% CI 0.64–0.84), with the optimal threshold shown at 68% sensitivity and 72% specificity.",
        "Durability bar chart at 3 months post-treatment compares maintained response rates: dTMS-ACC 61.9% vs HF-rTMS-SMA 44.4%, with error bars and significance annotation (p=0.048).",
      ],
    },
    breakpoints: [
      {
        label: "Research Question",
        content:
          "Which rTMS protocol — deep TMS targeting the ACC or high-frequency rTMS targeting the SMA — achieves superior Y-BOCS-II response rates compared to sham in adults with treatment-refractory OCD, and can pre-treatment EEG biomarkers predict non-response?",
        evidence: "Evidence: Objectives, p.2",
      },
      {
        label: "Data & Sample",
        content:
          "216 adults aged 18–60 with DSM-5 OCD (Y-BOCS-II ≥16; illness duration ≥2 years) refractory to ≥2 adequate SRI trials; excluded: implanted metal devices, seizure history, comorbid psychosis; enrolled across 6 OCD specialty clinics in Israel and Germany; mean age 36 years; 53% female.",
        evidence: "Evidence: Eligibility & Recruitment, p.4–5",
      },
      {
        label: "Method Highlights",
        content:
          "Three-arm, double-blind, sham-controlled RCT; 30 daily sessions (weekdays); dTMS-ACC via BrainsWay H7 coil at 100% MT; HF-rTMS-SMA at 110% MT (10 Hz, 40 trains); sham coil identical in appearance and sound; resting-state EEG biomarker substudy at baseline; blinded Y-BOCS-II assessments at weeks 3, 6, and 3-month follow-up.",
        evidence: "Evidence: Design & Procedures, p.5–8",
      },
      {
        label: "Key Results",
        content:
          "Response at week 6: dTMS-ACC 46.5% vs HF-rTMS-SMA 38.9% vs sham 14.1% (both p<0.001 vs sham); sessions 16–30 accounted for 58% of dTMS-ACC benefit; EEG OFC-caudate theta AUC 0.74; 3-month response maintenance: 61.9% dTMS vs 44.4% HF-rTMS (p=0.048).",
        evidence: "Evidence: Efficacy & Biomarker Results, p.8–13, Tables 2–3",
      },
      {
        label: "Implications & Limitations",
        content:
          "Supports 30-session dTMS-ACC as a new standard for refractory OCD neuromodulation; head-to-head comparison of two active protocols avoids credibility confounds; however, trial was conducted at specialist centers limiting real-world generalizability; optimal maintenance frequency after acute response remains unknown; EEG biomarker findings require prospective validation.",
        evidence: "Evidence: Discussion & Limitations, p.14–16",
      },
    ],
    relatedPapers: [
      {
        title:
          "Deep Transcranial Magnetic Stimulation for Obsessive-Compulsive Disorder: A Sham-Controlled Randomized Trial",
        journal: "American Journal of Psychiatry",
        year: 2019,
      },
      {
        title:
          "Cortical-Subcortical Dysconnectivity in OCD: A Meta-Analysis of Resting-State fMRI Studies",
        journal: "Neuropsychopharmacology",
        year: 2021,
      },
      {
        title:
          "Repetitive TMS for Obsessive-Compulsive Disorder: A Systematic Review and Meta-Analysis",
        journal: "Brain Stimulation",
        year: 2023,
      },
    ],
    dataLinks: {
      code: null,
      data: "EEG and clinical outcome data available through the Open Science Framework (osf.io/tms-ocd-2025) upon accepted data sharing application.",
    },
  },
  {
    id: "paper-006",
    title:
      "MDMA-Assisted Therapy for Severe Post-Traumatic Stress Disorder: Phase III Results",
    summary:
      "This phase III, randomized, double-blind, placebo-controlled trial — MAPP2 — evaluated the efficacy and safety of 3,4-methylenedioxymethamphetamine (MDMA)-assisted therapy in 104 adults with severe PTSD (CAPS-5 score ≥35) not responding to prior evidence-based psychotherapy or pharmacotherapy. Participants received three monthly MDMA sessions (80–120 mg plus optional supplemental dose) or placebo, each embedded within structured 90-minute non-directive psychotherapy sessions, along with 12 preparatory and integration therapy hours. The co-primary endpoints were CAPS-5 change score and functional impairment (Sheehan Disability Scale) at week 18. MDMA-assisted therapy produced a mean CAPS-5 reduction of 24.4 points (SD 11.2) versus 13.9 points (SD 9.8) with placebo (adjusted difference −10.5, 95% CI −14.2 to −6.8, p<0.001), and 71.2% of participants in the MDMA arm no longer met diagnostic criteria for PTSD at week 18 compared to 47.6% on placebo.\n\nSubgroup analyses demonstrated consistent efficacy across PTSD subtype (combat, sexual trauma, childhood abuse, and disaster-related), baseline dissociation severity, and comorbid major depression. Notably, the MDMA arm showed a 26-percentage-point higher rate of PTSD diagnostic loss in participants with comorbid MDD (73.3% vs 47.2%), suggesting particular utility in this frequently excluded population. Effect sizes (Cohen's d = 0.91) surpassed those achieved in prior Phase II trials and exceeded those reported for prolonged exposure therapy in comparable populations.\n\nClinically significant adverse events included transient blood pressure elevation during sessions (managed with observation), muscle tightness, and nausea, all resolving within the session day. One participant with undisclosed pre-existing cardiac arrhythmia experienced a non-life-threatening supraventricular tachycardia. No cases of suicidality or abuse potential emerged during the trial. These results build on the phase II evidence base and represent the most compelling clinical trial data yet submitted in support of regulatory consideration of MDMA-assisted therapy.",
    journal: "New England Journal of Medicine",
    year: 2025,
    date: "2025-04-02",
    specialty: "Psychiatry",
    specialtyColor: SPECIALTY_COLORS["Psychiatry"],
    badges: ["New This Week", "RCT"],
    tags: ["MDMA", "PTSD", "Psychedelic-Assisted Therapy"],
    evidenceRating: 5,
    authors: ["Mithoefer MC", "Jerome L", "Mitchell JM"],
    tldr:
      "Three monthly MDMA-assisted psychotherapy sessions reduced CAPS-5 PTSD severity by 24.4 points versus 13.9 for placebo and eliminated PTSD diagnosis in 71.2% of participants at 18 weeks — a Cohen's d of 0.91, exceeding effect sizes for existing first-line therapies. Efficacy was consistent across trauma subtypes and was even larger in participants with comorbid depression. Adverse effects were transient and managed within session, with no abuse potential or suicidality signals observed.",
    keyFindings: [
      "MDMA-assisted therapy reduced CAPS-5 scores by 24.4 points versus 13.9 for placebo (adjusted difference −10.5, 95% CI −14.2 to −6.8, p<0.001; Cohen's d=0.91), and 71.2% of MDMA participants no longer met PTSD diagnostic criteria at week 18 versus 47.6% on placebo.",
      "Efficacy was consistent across all PTSD subtypes — combat, sexual trauma, childhood abuse, and disaster-related — and the MDMA advantage was largest in those with comorbid MDD (PTSD loss: 73.3% vs 47.2%, p=0.011).",
      "Treatment-emergent adverse events were transient (resolving within the session day) and included muscle tightness (52% MDMA vs 14% placebo), nausea (38% vs 9%), and blood pressure elevation managed with observation; no suicidality, cardiovascular serious adverse events, or abuse potential signals emerged.",
    ],
    paperUrl: "#",
    liked: false,
    saved: false,
    readLater: false,
    originalTitle:
      "MDMA-Assisted Therapy for Post-Traumatic Stress Disorder: A Phase 3 Randomized, Double-Blind, Placebo-Controlled Trial (MAPP2)",
    citations: 389,
    laySummary:
      "A clinical trial tested three monthly sessions where participants with severe PTSD took MDMA — the active ingredient in ecstasy — under careful supervision alongside psychotherapy. More than 71% of those who received MDMA no longer had a PTSD diagnosis at the end of the study, compared to around 48% who received psychotherapy with a placebo. The treatment was consistently effective regardless of what type of trauma caused the PTSD, and side effects were mild and temporary.",
    originalAbstract:
      "This phase III, randomized, double-blind, placebo-controlled trial — MAPP2 — evaluated the efficacy and safety of MDMA-assisted therapy in 104 adults with severe PTSD (CAPS-5 score ≥35) not responding to prior evidence-based psychotherapy or pharmacotherapy. Participants received three monthly MDMA sessions (80–120 mg plus optional supplemental dose) or placebo, each embedded within structured non-directive psychotherapy sessions, along with 12 preparatory and integration therapy hours. The co-primary endpoints were CAPS-5 change score and functional impairment at week 18. MDMA-assisted therapy produced a mean CAPS-5 reduction of 24.4 points (SD 11.2) versus 13.9 points (SD 9.8) with placebo (adjusted difference −10.5, 95% CI −14.2 to −6.8, p<0.001), and 71.2% of participants in the MDMA arm no longer met diagnostic criteria for PTSD at week 18 compared to 47.6% on placebo.\n\nSubgroup analyses demonstrated consistent efficacy across PTSD subtype (combat, sexual trauma, childhood abuse, and disaster-related), baseline dissociation severity, and comorbid major depression. Notably, the MDMA arm showed a 26-percentage-point higher rate of PTSD diagnostic loss in participants with comorbid MDD (73.3% vs 47.2%). Effect sizes (Cohen's d=0.91) surpassed those achieved in prior phase II trials and exceeded those reported for prolonged exposure therapy in comparable populations.\n\nClinically significant adverse events were transient and included blood pressure elevation (managed with observation), muscle tightness, and nausea. No cases of suicidality or abuse potential emerged during the trial.",
    figureDigest: {
      caption: "Figure 1",
      findings: [
        "CAPS-5 score change from baseline through week 18 shows rapid divergence between MDMA and placebo arms beginning after session 1 (week 2), with an adjusted between-group difference of −10.5 points at week 18.",
        "PTSD diagnostic loss rates at week 18 are displayed as a stacked bar chart: 71.2% MDMA vs 47.6% placebo, with 95% confidence intervals and annotation of the number needed to treat (NNT=4.2).",
        "Subgroup forest plot stratified by PTSD etiology (combat, sexual assault, childhood trauma, disaster) and comorbid MDD status shows consistent MDMA benefit across all subgroups, with the largest effect size in the comorbid MDD subgroup (d=1.08).",
        "Sheehan Disability Scale total score change plot demonstrates that functional improvement paralleled symptom reduction, with MDMA participants showing 8.3-point greater improvement in occupational, social, and family functioning domains (p<0.001).",
      ],
    },
    breakpoints: [
      {
        label: "Research Question",
        content:
          "Does MDMA-assisted psychotherapy (three monthly sessions, 80–120 mg) produce superior CAPS-5 score reduction and functional improvement compared to placebo-assisted psychotherapy at 18 weeks in adults with severe, treatment-refractory PTSD?",
        evidence: "Evidence: Objectives & Co-primary Endpoints, p.2–3",
      },
      {
        label: "Data & Sample",
        content:
          "104 adults aged 18–68 with severe PTSD (CAPS-5 ≥35) who had not responded to ≥1 prior evidence-based treatment; excluded: active suicidality, primary psychosis, unstable cardiovascular disease; enrolled across 15 MAPS-certified therapy sites in the USA, Canada, and Israel; median CAPS-5 44.3; 66% female; 49% with comorbid MDD.",
        evidence: "Evidence: Eligibility & Participants, p.4–5",
      },
      {
        label: "Method Highlights",
        content:
          "Phase III double-blind placebo-controlled RCT; 3 monthly MDMA/placebo sessions (80 mg + optional 40 mg) each within 8-hour non-directive psychotherapy; 12 h preparatory and integration sessions; co-primary endpoints CAPS-5 change and SDS at week 18; blinded independent CAPS-5 assessors; 12-month long-term follow-up planned as open-label extension.",
        evidence: "Evidence: Design & Procedures, p.5–8, Figure S1",
      },
      {
        label: "Key Results",
        content:
          "CAPS-5 reduction: −24.4 MDMA vs −13.9 placebo (adjusted difference −10.5, p<0.001; d=0.91); PTSD diagnostic loss: 71.2% vs 47.6%; SDS improvement −8.3 pts (p<0.001); comorbid MDD subgroup PTSD loss: 73.3% vs 47.2% (p=0.011); no suicidality or abuse potential signals.",
        evidence: "Evidence: Efficacy & Safety Results, p.8–14, Tables 2–4",
      },
      {
        label: "Implications & Limitations",
        content:
          "Phase III data represent the strongest evidence yet for MDMA-assisted therapy in severe PTSD; blinding integrity is challenged by the subjective effects of MDMA; small sample size relative to a phase III program; risk of expectation bias in participant-reported outcomes; regulatory decisions must weigh therapeutic potential against risks in non-supervised settings; long-term follow-up data are still pending.",
        evidence: "Evidence: Discussion & Limitations, p.15–18",
      },
    ],
    relatedPapers: [
      {
        title:
          "MDMA-Assisted Psychotherapy for PTSD: A Randomized, Double-Blind, Placebo-Controlled Phase 3 Trial (MAPP1)",
        journal: "Nature Medicine",
        year: 2021,
      },
      {
        title:
          "Compassionate Use of MDMA-Assisted Psychotherapy in Chronic, Treatment-Resistant PTSD: Expanded Access Program Outcomes",
        journal: "Frontiers in Psychiatry",
        year: 2023,
      },
      {
        title:
          "Efficacy and Safety of Prolonged Exposure Therapy for Post-Traumatic Stress Disorder: A Systematic Review",
        journal: "JAMA Psychiatry",
        year: 2019,
      },
    ],
    dataLinks: {
      code: null,
      data: "Participant-level clinical data available through MAPS Public Benefit Corporation clinical trial data sharing portal (clinicaltrials.maps.org) upon approved data access application.",
    },
  },
  {
    id: "paper-007",
    title:
      "Neural Circuit Biomarkers Predicting Antidepressant Response via Machine Learning",
    summary:
      "This prospective multicenter cohort study developed and validated machine learning models integrating resting-state fMRI functional connectivity, structural MRI morphometry, and clinical variables to predict individual-level antidepressant response at 8 weeks in 1,142 adults with a current major depressive episode. Participants were enrolled prior to initiating a new antidepressant (sertraline, escitalopram, or venlafaxine) and underwent neuroimaging at baseline; clinical outcomes were assessed at weeks 2, 4, and 8 using the Quick Inventory of Depressive Symptomatology-Self-Report (QIDS-SR). A gradient-boosted tree ensemble trained on 68 functional connectivity features achieved a cross-validated AUC of 0.81 (95% CI 0.77–0.84) for predicting response (≥50% QIDS-SR reduction), outperforming clinical-only models (AUC 0.62) and neuroimaging-only models (AUC 0.71).\n\nThe three most informative predictive features were subgenual anterior cingulate–dorsolateral prefrontal cortex (sgACC–dlPFC) anticorrelation strength, thalamo-cortical functional connectivity, and amygdala-hippocampal resting connectivity, all of which have established mechanistic relevance to antidepressant action. External validation in an independent held-out cohort of 287 participants from two separate sites yielded an AUC of 0.78 (95% CI 0.73–0.83), confirming model generalizability. A decision-curve analysis demonstrated net clinical benefit of the model-guided treatment strategy over treat-all or treat-none approaches across a probability threshold range of 0.30–0.75.\n\nProspective simulation analyses estimated that applying the model as a clinical decision support tool could reduce the proportion of patients exposed to an inadequate first antidepressant by 34% (95% CI 27–41%), potentially shortening time-to-remission by an estimated 6.2 weeks at a population level. These findings establish a clinically viable neuroimaging-based precision psychiatry framework for antidepressant selection, though prospective interventional trials are needed to confirm clinical utility.",
    journal: "Nature Neuroscience",
    year: 2025,
    date: "2025-02-27",
    specialty: "Neurology",
    specialtyColor: SPECIALTY_COLORS["Neurology"],
    badges: ["New This Week", "Cohort Study"],
    tags: ["Machine Learning", "Precision Psychiatry", "fMRI Biomarkers"],
    evidenceRating: 4,
    authors: ["Williams LM", "Etkin A", "Gotlib IH"],
    tldr:
      "A machine learning model combining resting-state fMRI connectivity and clinical variables predicted antidepressant response at 8 weeks with an AUC of 0.81 in 1,142 patients starting a new antidepressant, validated at 0.78 in an external cohort. The key predictive feature was sgACC–dlPFC anticorrelation, a circuit implicated in affective regulation and antidepressant mechanism. Simulation analyses estimate that clinical deployment could reduce inadequate first-antidepressant exposure by 34% and shorten time-to-remission by 6.2 weeks at a population level.",
    keyFindings: [
      "A gradient-boosted tree ensemble integrating 68 fMRI connectivity features achieved cross-validated AUC of 0.81 (95% CI 0.77–0.84) for antidepressant response prediction, outperforming clinical-only (AUC 0.62) and neuroimaging-only (AUC 0.71) models (both p<0.001).",
      "External validation in 287 held-out participants from two independent sites confirmed model generalizability (AUC 0.78, 95% CI 0.73–0.83), with sgACC–dlPFC anticorrelation, thalamo-cortical connectivity, and amygdala-hippocampal connectivity as the three most informative features.",
      "Decision-curve analysis and prospective simulation estimated that model-guided treatment selection could reduce inadequate first-antidepressant exposure by 34% (95% CI 27–41%) and shorten population-level time-to-remission by an estimated 6.2 weeks.",
    ],
    paperUrl: "#",
    liked: false,
    saved: false,
    readLater: false,
    originalTitle:
      "Neuroimaging-Informed Machine Learning Models for Predicting Individual Antidepressant Response in Major Depressive Disorder: Development, Validation, and Clinical Decision-Curve Analysis in a Prospective Multicenter Cohort of 1,429 Patients",
    citations: 112,
    laySummary:
      "Choosing the right antidepressant for a given patient is currently a matter of trial and error, with many people cycling through several medications before finding one that works. This study used brain scan data taken before treatment began to train a computer model that could predict — with about 81% accuracy — whether a specific antidepressant would work for each patient. Simulations suggested that using this model as a clinical guide could cut in half the number of patients who go through an ineffective first medication, potentially getting people to remission months sooner.",
    originalAbstract:
      "This prospective multicenter cohort study developed and validated machine learning models integrating resting-state fMRI functional connectivity, structural MRI morphometry, and clinical variables to predict individual-level antidepressant response at 8 weeks in 1,142 adults with a current major depressive episode. Participants were enrolled prior to initiating a new antidepressant (sertraline, escitalopram, or venlafaxine) and underwent neuroimaging at baseline; clinical outcomes were assessed at weeks 2, 4, and 8 using the QIDS-SR. A gradient-boosted tree ensemble trained on 68 functional connectivity features achieved a cross-validated AUC of 0.81 (95% CI 0.77–0.84) for predicting response (≥50% QIDS-SR reduction), outperforming clinical-only models (AUC 0.62) and neuroimaging-only models (AUC 0.71).\n\nThe three most informative predictive features were sgACC–dlPFC anticorrelation strength, thalamo-cortical functional connectivity, and amygdala-hippocampal resting connectivity. External validation in an independent held-out cohort of 287 participants from two separate sites yielded an AUC of 0.78 (95% CI 0.73–0.83), confirming model generalizability. A decision-curve analysis demonstrated net clinical benefit of the model-guided treatment strategy over treat-all or treat-none approaches across a probability threshold range of 0.30–0.75.\n\nProspective simulation analyses estimated that applying the model as a clinical decision support tool could reduce the proportion of patients exposed to an inadequate first antidepressant by 34% (95% CI 27–41%), potentially shortening time-to-remission by an estimated 6.2 weeks at a population level.",
    figureDigest: {
      caption: "Figure 1",
      findings: [
        "ROC curves for the combined neuroimaging+clinical model (AUC 0.81), neuroimaging-only model (AUC 0.71), and clinical-only model (AUC 0.62) are displayed side-by-side; the combined model's curve dominates across all specificity thresholds, with the largest separation at false-positive rates of 0.1–0.3.",
        "Feature importance bar chart ranks the top 20 predictive fMRI connectivity features; sgACC–dlPFC anticorrelation, thalamo-cortical connectivity, and amygdala-hippocampal connectivity are the top three, with importance scores substantially exceeding the next tier.",
        "External validation performance panel displays the model's AUC (0.78), sensitivity (0.73), and specificity (0.71) in the two held-out independent cohorts, with overlapping 95% CI bars confirming generalizability across sites and scanner types.",
        "Decision-curve analysis plots net benefit as a function of probability threshold for the model-guided strategy versus treat-all and treat-none baselines; the model shows positive net benefit across a clinically relevant threshold range of 0.30–0.75.",
      ],
    },
    breakpoints: [
      {
        label: "Research Question",
        content:
          "Can machine learning models integrating baseline resting-state fMRI functional connectivity features with clinical variables predict individual antidepressant response (≥50% QIDS-SR reduction) at 8 weeks in adults with major depressive disorder, and do they offer clinical decision support value beyond clinical variables alone?",
        evidence: "Evidence: Objectives & Aims, p.2–3",
      },
      {
        label: "Data & Sample",
        content:
          "1,142 adults aged 18–65 with current MDD (QIDS-SR ≥11) initiating a new antidepressant (sertraline 50–200 mg, escitalopram 10–20 mg, or venlafaxine 75–225 mg); enrolled across 9 academic medical centers in the USA and UK; external validation cohort: 287 participants from 2 independent sites; median age 38 years; 59% female.",
        evidence: "Evidence: Participants & Settings, p.4–6",
      },
      {
        label: "Method Highlights",
        content:
          "Prospective cohort design; baseline 3T resting-state fMRI (10 min, eyes open); 68 pre-defined functional connectivity features derived from 14 canonical networks; gradient-boosted tree ensembles, random forests, and logistic regression compared; nested 5-fold cross-validation; external validation in held-out cohort; decision-curve analysis and simulation of clinical deployment scenarios.",
        evidence: "Evidence: Methods & Statistical Analysis, p.6–10, Figure S3",
      },
      {
        label: "Key Results",
        content:
          "Combined model AUC 0.81 (vs clinical-only 0.62, p<0.001); external validation AUC 0.78; top features: sgACC–dlPFC anticorrelation, thalamo-cortical, amygdala-hippocampal connectivity; model deployment simulation: 34% reduction in inadequate first-antidepressant exposure (95% CI 27–41%); estimated 6.2-week reduction in time-to-remission.",
        evidence: "Evidence: Model Development & Validation, p.10–16, Figures 2–4",
      },
      {
        label: "Implications & Limitations",
        content:
          "Establishes the largest neuroimaging-ML precision psychiatry cohort to date; model requires 3T fMRI, limiting real-world implementation to well-resourced centers; observational design cannot establish causal direction; no interventional arm to confirm clinical utility of model-guided prescription; prediction accuracy (AUC 0.81) still leaves ~19% of decisions uncertain; prospective randomized clinical utility trial is now warranted.",
        evidence: "Evidence: Discussion & Limitations, p.17–20",
      },
    ],
    relatedPapers: [
      {
        title:
          "Toward a Neuroimaging Biomarker for Major Depressive Disorder: Current Progress and Future Directions",
        journal: "Molecular Psychiatry",
        year: 2021,
      },
      {
        title:
          "Subgenual Anterior Cingulate–Medial Prefrontal Cortical Connectivity Predicts Antidepressant Response in Major Depression",
        journal: "Biological Psychiatry",
        year: 2018,
      },
      {
        title:
          "Precision Psychiatry: Using Neuroimaging Biomarkers to Guide Antidepressant Treatment Selection",
        journal: "JAMA Psychiatry",
        year: 2022,
      },
    ],
    dataLinks: {
      code: "https://github.com/williams-etkin-lab/mdd-antidepressant-ml",
      data: "De-identified neuroimaging and clinical data deposited in the OpenNeuro repository (accession ds005041) and the NIMH Data Archive (NDA collection: 3247) under a controlled data access agreement.",
    },
  },
  {
    id: "paper-008",
    title:
      "Digital Phenotyping and Smartphone-Based CBT for Early Psychosis Intervention",
    summary:
      "This pragmatic, parallel-group randomized controlled trial evaluated a smartphone-delivered digital intervention — PsychSense — combining passive digital phenotyping (accelerometry, GPS mobility, screen time, and voice acoustic analysis) with an adaptive cognitive-behavioral therapy (CBT) module in 298 young adults aged 16–35 presenting to early psychosis intervention (EPI) programs. Participants were randomized 1:1 to PsychSense plus treatment-as-usual (TAU) or TAU alone for 24 weeks. The primary endpoint was psychosis relapse or functional deterioration, defined as a composite of psychiatric hospitalization, ≥30% increase in Positive and Negative Syndrome Scale (PANSS) total score, or Global Assessment of Functioning (GAF) decline of ≥10 points. The PsychSense group demonstrated a 38% relative risk reduction in the composite primary endpoint (22.8% vs 36.9%; RR 0.62, 95% CI 0.43–0.88, p=0.007).\n\nDigital phenotyping features provided real-time passive warning signals: a machine learning anomaly detector trained on individual behavioral baselines identified prodromal relapse signatures (GPS mobility reduction, nocturnal screen activity increase, and speech rate deceleration) with a sensitivity of 79% and specificity of 71% at a median of 8.4 days before clinical relapse, substantially exceeding standard symptom self-monitoring approaches. The adaptive CBT module delivered personalized cognitive restructuring and behavioral activation micro-sessions triggered by real-time anomaly signals, with adherence monitored through session completion logs. Per-protocol analyses confirmed primary findings (RR 0.58, 95% CI 0.39–0.87).\n\nPsychSense was well-accepted, with 73.5% of intervention-arm participants completing ≥75% of triggered CBT modules and a mean app engagement of 6.2 days/week. Privacy concerns were assessed via the Digital Privacy Concerns Questionnaire (DPCQ); scores were low and did not moderate outcomes. These findings demonstrate that passively collected smartphone behavioral data, integrated with adaptive digital therapeutics, can substantially reduce psychosis relapse risk in a high-risk early-course population.",
    journal: "The Lancet Digital Health",
    year: 2025,
    date: "2025-03-20",
    specialty: "Other",
    specialtyColor: SPECIALTY_COLORS["Other"],
    badges: ["New This Week", "RCT"],
    tags: ["Digital Health", "Early Psychosis", "Smartphone CBT"],
    evidenceRating: 4,
    authors: ["Barnett I", "Torous J", "Insel TR"],
    tldr:
      "A smartphone app combining passive digital phenotyping with adaptive CBT reduced psychosis relapse or functional deterioration by 38% over 24 weeks in young adults enrolled in early psychosis intervention programs. The passive monitoring algorithm identified prodromal relapse signatures a median of 8.4 days before clinical deterioration, with 79% sensitivity and 71% specificity. High app engagement (73.5% completing ≥75% of modules) and low privacy concern scores suggest strong real-world feasibility.",
    keyFindings: [
      "PsychSense plus TAU reduced the composite relapse/functional deterioration endpoint by 38% compared to TAU alone (22.8% vs 36.9%; RR 0.62, 95% CI 0.43–0.88, p=0.007), translating to a number needed to treat of 7.2.",
      "The digital phenotyping anomaly detector predicted clinical relapse at a median of 8.4 days in advance (sensitivity 79%, specificity 71%), driven by GPS mobility reduction, nocturnal screen activity increase, and speech rate deceleration.",
      "App adherence was high, with 73.5% of intervention participants completing ≥75% of triggered CBT modules at a mean engagement frequency of 6.2 days/week; privacy concern scores were low and did not moderate primary outcomes.",
    ],
    paperUrl: "#",
    liked: false,
    saved: false,
    readLater: false,
    originalTitle:
      "Digital Phenotyping-Triggered Smartphone Cognitive-Behavioral Therapy for Relapse Prevention in Early Psychosis: A Pragmatic Randomized Controlled Trial (PsychSense Trial)",
    citations: 58,
    laySummary:
      "A smartphone app that silently monitors behavior — tracking movement, sleep, phone use, and voice patterns — can detect early warning signs of psychosis relapse more than a week before a clinical crisis, and can automatically deliver targeted therapy exercises to help prevent deterioration. Young people enrolled in early psychosis programs who used the app had a 38% lower risk of relapse or significant worsening over six months compared to those receiving standard care alone. Most participants used the app consistently throughout the study and expressed few concerns about privacy.",
    originalAbstract:
      "This pragmatic, parallel-group randomized controlled trial evaluated a smartphone-delivered digital intervention — PsychSense — combining passive digital phenotyping (accelerometry, GPS mobility, screen time, and voice acoustic analysis) with an adaptive cognitive-behavioral therapy (CBT) module in 298 young adults aged 16–35 presenting to early psychosis intervention (EPI) programs. Participants were randomized 1:1 to PsychSense plus treatment-as-usual (TAU) or TAU alone for 24 weeks. The primary endpoint was psychosis relapse or functional deterioration, defined as a composite of psychiatric hospitalization, ≥30% increase in PANSS total score, or GAF decline of ≥10 points. The PsychSense group demonstrated a 38% relative risk reduction in the composite primary endpoint (22.8% vs 36.9%; RR 0.62, 95% CI 0.43–0.88, p=0.007).\n\nDigital phenotyping features provided real-time passive warning signals: a machine learning anomaly detector trained on individual behavioral baselines identified prodromal relapse signatures (GPS mobility reduction, nocturnal screen activity increase, and speech rate deceleration) with a sensitivity of 79% and specificity of 71% at a median of 8.4 days before clinical relapse. The adaptive CBT module delivered personalized cognitive restructuring and behavioral activation micro-sessions triggered by real-time anomaly signals. Per-protocol analyses confirmed primary findings (RR 0.58, 95% CI 0.39–0.87).\n\nPsychSense was well-accepted, with 73.5% of intervention-arm participants completing ≥75% of triggered CBT modules and a mean app engagement of 6.2 days/week. Privacy concern scores were low and did not moderate outcomes. These findings demonstrate that passively collected smartphone behavioral data, integrated with adaptive digital therapeutics, can substantially reduce psychosis relapse risk in a high-risk early-course population.",
    figureDigest: {
      caption: "Figure 1",
      findings: [
        "Kaplan-Meier curves for the time-to-first-relapse/functional-deterioration composite event over 24 weeks show early and sustained separation between the PsychSense+TAU and TAU-alone arms beginning at approximately week 6, with log-rank p=0.006.",
        "Digital phenotyping anomaly detection ROC curve at the threshold optimized for 8.4-day pre-relapse detection demonstrates AUC 0.82 (sensitivity 79%, specificity 71%), substantially outperforming a univariate self-reported symptom monitoring model (AUC 0.61).",
        "Feature importance heatmap displays the relative contribution of each passive digital phenotyping domain (GPS mobility, screen time, accelerometry, voice acoustics) to relapse prediction across all 128 detected relapse events.",
        "App engagement heatmap shows daily session completion rates across the 24-week intervention period for all PsychSense participants; engagement is highest in the first 4 weeks and stabilizes above 5 days/week throughout, with CBT module completion correlated negatively with relapse (r=−0.41, p<0.001).",
      ],
    },
    breakpoints: [
      {
        label: "Research Question",
        content:
          "Does a smartphone app (PsychSense) combining passive digital phenotyping with triggered adaptive CBT modules reduce psychosis relapse and functional deterioration compared to treatment-as-usual alone in young adults enrolled in early psychosis intervention programs over 24 weeks?",
        evidence: "Evidence: Objectives & Primary Endpoint, p.2–3",
      },
      {
        label: "Data & Sample",
        content:
          "298 young adults aged 16–35 within 2 years of first psychosis episode or ultra-high risk for psychosis, enrolled at EPI clinics in the USA and Australia; excluded: no smartphone access, current acute inpatient admission; median age 22 years; 48% female; 62% first-episode psychosis, 38% ultra-high risk.",
        evidence: "Evidence: Eligibility & Enrollment, p.4–5",
      },
      {
        label: "Method Highlights",
        content:
          "Pragmatic parallel-group RCT; PsychSense iOS/Android app: continuous passive digital phenotyping (GPS, accelerometry, screen usage, voice acoustics via microphone during phone calls with participant consent) + individual behavioral baseline ML anomaly detector; CBT micro-sessions triggered by anomaly alerts; TAU at EPI clinics for both arms; blinded composite endpoint adjudication; 24-week follow-up with monthly in-person PANSS and GAF assessments.",
        evidence: "Evidence: Intervention Design & Procedures, p.5–9, Figure S2",
      },
      {
        label: "Key Results",
        content:
          "Composite relapse/deterioration: 22.8% PsychSense vs 36.9% TAU (RR 0.62, p=0.007; NNT 7.2); per-protocol RR 0.58 (p=0.009); anomaly detection AUC 0.82, sensitivity 79%, specificity 71%, median 8.4-day advance warning; app adherence 73.5% completing ≥75% of CBT modules; engagement 6.2 days/week.",
        evidence: "Evidence: Efficacy & Digital Phenotyping Results, p.9–15, Tables 2–3",
      },
      {
        label: "Implications & Limitations",
        content:
          "PsychSense represents the first adequately powered RCT demonstrating that digital phenotyping-triggered adaptive CBT reduces hard clinical outcomes in early psychosis; pragmatic design limits protocol standardization across EPI sites; passive voice monitoring raises ongoing ethical and consent questions; the ML anomaly detector was trained within-individual and requires a 2-week baseline period; generalizability to later-stage psychosis or populations without smartphone access is unknown.",
        evidence: "Evidence: Discussion & Limitations, p.16–19",
      },
    ],
    relatedPapers: [
      {
        title:
          "Smartphones as New Tools in the Management and Understanding of Bipolar Disorder and Schizophrenia",
        journal: "NPJ Schizophrenia",
        year: 2021,
      },
      {
        title:
          "Digital Phenotyping in Mental Health: A Critical Review of Data Governance, Privacy, and Clinical Utility",
        journal: "World Psychiatry",
        year: 2023,
      },
      {
        title:
          "Cognitive-Behavioral Therapy for Ultra-High Risk of Psychosis: A Randomized Controlled Trial",
        journal: "The Lancet Psychiatry",
        year: 2020,
      },
    ],
    dataLinks: {
      code: "https://github.com/barnett-torous-lab/psychsense-trial",
      data: "De-identified clinical outcomes data available through the NIMH Data Archive (NDA collection: 3318); digital phenotyping data available under a restricted-access agreement due to re-identification risk.",
    },
  },
];
