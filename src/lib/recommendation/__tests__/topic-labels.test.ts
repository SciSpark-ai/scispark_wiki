import { expect, it } from "vitest"
import { feedTopicLabels } from "../topic-labels"

it("separates concise topics from explanatory notes in existing cached tags", () => {
  expect(feedTopicLabels([
    "attention switching) — very strong",
    "auditory attention decoding (eeg",
    "cortical tracking of continuous speech / mtrf methodology — continued heavy use: mtrf toolbox paper reopened 4+ times this period",
  ], [])).toEqual(["attention switching", "auditory attention decoding", "cortical tracking of continuous speech / mtrf methodology"])
})
it("rejects instructions and long prose, falling back to complete subject fields", () => {
  expect(feedTopicLabels(['search "cortical speech tracking noise robustness"', "This long recommendation explains repeated reading activity rather than naming a clear research topic for the paper."], ["Neuroscience", "neuroscience", "Speech (EEG)"])).toEqual(["Neuroscience", "Speech (EEG)"])
})
it("preserves short technical names and limits distinct chips", () => {
  expect(feedTopicLabels(["EEG", "eeg", "speech-language", "脑电研究", "TRF"], [])).toEqual(["EEG", "speech-language", "脑电研究"])
})
