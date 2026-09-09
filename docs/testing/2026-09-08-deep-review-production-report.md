# Methodological Comparison of Temporal Response Functions and Envelope Reconstruction in Adult Speech-in-Noise EEG

Evidence access: 3 abstract-only, 0 full-text, 0 uploaded-PDF sources cited.

This draft passed automated claim-support checks, not independent scientific validation. Abstracts cannot establish details they do not report. This is not an exhaustive or systematic review.

## Encoding Approaches and Temporal Response Functions

In system identification approaches applied to EEG and MEG data, temporal response functions fit linear filters describing a mapping between sensory stimulus features and neural responses. [P3] Regularized linear regression can derive temporal response functions mapping between stimulus and response in both directions, with regularization optimized for a given dataset. [P3]

Cortical speech tracking in the theta frequency band encodes mostly speech clarity and acoustic aspects of the signal, whereas delta-band tracking encodes higher-level speech comprehension. [P2] An early neural component in the delta band informs on comprehension and may reflect a predictive mechanism for language processing. [P2] A temporal response function involves fitting a filter that describes a mapping between features of a sensory stimulus and the neural response. [P3] Multivariate temporal response functions can be derived to describe mappings between stimulus and neural response in both forward and backward directions. [P3]

## Decoding Models and Envelope Reconstruction Paradigms

In auditory attention detection using electroencephalography, decoded neural signals are correlated with the temporal envelopes of speech signals from separate speakers to determine which of two simultaneous speakers a listener is attending to. [P5] For auditory attention detection, speech envelope extraction achieves the best performance when incorporating an auditory-inspired linear filter bank followed by power-law compression, both of which are computationally cheap. [P5] Combining recordings across trials and subjects to train the decoder reduces the dependence of the auditory attention detection algorithm on regularization parameters. [P5] Simultaneously designing the electroencephalography decoder and audio subband envelope recombination weights vector using norm-constrained least squares or canonical correlation analysis increases computational complexity without improving auditory attention detection performance. [P5]

In auditory attention detection paradigms designed to identify which speaker a listener is attending to, decoded EEG signals are typically correlated with the temporal speech envelopes of the separate speakers. [P5] Both decoding and encoding frameworks can be applied to EEG responses to native and foreign speech in background noise to relate speech clarity and comprehension to neural activity. [P2] Both speech clarity and speech comprehension can be accurately decoded from relatively short segments of EEG recordings. [P2] Cortical speech tracking in the theta frequency band correlates predominantly with speech clarity, whereas the delta band contributes most to speech comprehension. [P2]

## Comparative Applications, Disambiguation in Noise, and Open Methodological Questions

Regularized linear regression can be used to derive temporal response functions that map between continuous sensory stimulus features and neural responses, such as EEG or MEG signals, in both directions. [P3] When relating neural responses to speech in background noise using encoding and decoding approaches, cortical tracking in the theta frequency band correlates primarily with speech clarity, whereas tracking in the delta frequency band contributes most to speech comprehension. [P2] An early neural component observed in the delta frequency band informs on speech comprehension in noise and may reflect a predictive language processing mechanism. [P2] Both speech clarity and comprehension can be accurately decoded from relatively short segments of EEG recordings. [P2] In auditory attention detection paradigms determining which of two simultaneous speakers a listener attends to, decoded EEG signals are typically correlated with the separate speakers' temporal speech envelopes. [P5]

In speech envelope extraction for EEG-based auditory attention detection, the highest performance is obtained using an auditory-inspired linear filter bank followed by power law compression. [P5] Combining recordings across trials and subjects when training the EEG decoder decreases the dependence of the algorithm on regularization parameters. [P5] Simultaneously optimizing the EEG decoder and audio subband envelope recombination weights using canonical correlation analysis or norm-constrained least squares increases computational complexity without improving auditory attention detection performance. [P5] Both encoding and decoding approaches can relate speech clarity and comprehension to neural responses, with cortical tracking in the theta band correlating primarily with clarity and the delta band contributing most to comprehension. [P2] Regularized linear regression can be used to derive multivariate temporal response functions mapping between sensory stimuli and neural responses in both directions. [P3]

## Open research questions

These are questions left open by the available evidence, not established findings.

- How envelope reconstruction and forward temporal response functions differ in their specific assumptions, measurement capabilities, and limitations for studying speech perception in noise in adult EEG.
- How forward temporal response functions compare directly to backward envelope reconstruction in reconstruction accuracy and sensitivity for evaluating speech perception in background noise.
- What specific regularization parameters and filter optimization settings best dissociate acoustic clarity tracking from linguistic comprehension across different adult EEG cohorts.
- How envelope reconstruction directly compares to temporal response functions in terms of theoretical assumptions and specific neural mechanisms measured during speech perception in noise.
- The relative limitations and performance differences between forward temporal response function encoding and backward envelope decoding specifically in adult EEG under adverse noise conditions.
- How forward encoding models (such as temporal response functions) directly compare in performance and noise robustness against backward decoding models (such as envelope reconstruction) for speech perception in noise.
- The explicit mathematical formulations and adult sample sizes underlying the comparative performance of envelope reconstruction and temporal response functions in noise, which were not reported in the retrieved abstracts.
- How forward encoding models and backward stimulus reconstruction directly compare in noise tolerance, SNR thresholds, or quantitative tracking accuracy under identical experimental conditions.
- The extent to which delta and theta tracking differences generalize across specific adult age cohorts, clinical populations, or non-speech background maskers.
- Whether forward encoding models or backward decoding models provide greater statistical power or robustness across varying levels of acoustic noise in adult EEG.
- Whether auditory-inspired acoustic preprocessing techniques (such as linear filter banks with power-law compression) provide benefits to forward temporal response function models comparable to those observed in backward envelope decoding.

## Sources

- [P2] Neural Speech Tracking in the Theta and in the Delta Frequency Band Differentially Encode Clarity and Comprehension of Speech in Noise — abstract; Abstract
- [P3] The Multivariate Temporal Response Function (mTRF) Toolbox: A MATLAB Toolbox for Relating Neural Signals to Continuous Stimuli — abstract; Abstract
- [P5] Auditory-Inspired Speech Envelope Extraction Methods for Improved EEG-Based Auditory Attention Detection in a Cocktail Party Scenario — abstract; Abstract


## Study comparison

Fields show source excerpts, not inferred study details.

| Paper | Population | Methods | Findings | Limitations |
| --- | --- | --- | --- | --- |
| [P2] | Not reported in available text | recording EEG responses to native and foreign language in different levels of background noise, for which clarity and comprehension vary independently. | We find that cortical tracking in the theta frequency band is mainly correlated to clarity, whereas the delta band contributes most to speech comprehension. | Not reported in available text |
| [P3] | Not reported in available text | describe a specific technique for deriving temporal response functions known as regularized linear regression. We then introduce a new open-source toolbox for performing this analysis. We describe how it can be used to derive (multivariate) temporal response functions describing a mapping between stimulus and response in both directions. | We describe how it can be used to derive (multivariate) temporal response functions describing a mapping between stimulus and response in both directions. We also explain the importance of regularizing the analysis and how this regularization can be optimized for a particular dataset. | Not reported in available text |
| [P5] | Not reported in available text | In this paper, we study how the inclusion of various degrees of auditory modelling in this speech envelope extraction process affects the AAD performance | the best performance is found for an auditory-inspired linear filter bank followed by power law compression. | Not reported in available text |

## Coverage and access limits

- Coverage question: Direct comparative evidence evaluating the methodological trade-offs between forward temporal response functions (encoding) and backward envelope reconstruction (decoding) in adult EEG, specifically contrasting what each measures (e.g., latency/topography vs. stimulus reconstruction fidelity) and their core assumptions under acoustic noise.
- Coverage question: Empirical evidence examining the specific limitations, discrepancies, and remaining uncertainties of TRFs versus envelope reconstruction across varying signal-to-noise ratios (SNRs) during speech perception in noise.
- Bounded review: two search rounds and a limited reading set. Coverage is not exhaustive.
- Full text access restricted


## References

[P2] Octave Etard, Tobias Reichenbach (2019). Neural Speech Tracking in the Theta and in the Delta Frequency Band Differentially Encode Clarity and Comprehension of Speech in Noise. Journal of Neuroscience https://doi.org/10.1523/jneurosci.1828-18.2019 Access: abstract.

[P3] Michael J. Crosse, Giovanni M. Di Liberto, Adam Bednar, Edmund C. Lalor (2016). The Multivariate Temporal Response Function (mTRF) Toolbox: A MATLAB Toolbox for Relating Neural Signals to Continuous Stimuli. Frontiers in Human Neuroscience https://doi.org/10.3389/fnhum.2016.00604 Access: abstract.

[P5] Wouter Biesmans, Neetha Das, Tom Francart, Alexander Bertrand (2016). Auditory-Inspired Speech Envelope Extraction Methods for Improved EEG-Based Auditory Attention Detection in a Cocktail Party Scenario. IEEE Transactions on Neural Systems and Rehabilitation Engineering https://doi.org/10.1109/tnsre.2016.2571900 Access: abstract.
