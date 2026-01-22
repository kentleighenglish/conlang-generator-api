import translate from "google-translate-api-x";
// @ts-expect-error there are no datamuse types, and can't be bothered to make some
import datamuse from "datamuse";
import * as z from "zod";
import { fetchIPA } from "./helpers/unalengua.js";

// import { OldManergot } from "../languages/old-manergot";

// import {
//   type Translation,
//   type TranslateResponse,
//   type LanguageKey,
//   ValidLanguages,
// } from "../../types/translate";

// type LanguageClassConstructor = new () => LanguageClass;
// const languages: LanguageClassConstructor[] = [
//     OldManergot,
//     // "New Manergot":
//     // "Tamani":
//     // "Ogma":
// ];

// type ScoredWord = { word: string; score: number };

const grabSynonyms = cachedFunction(
  async (input: string): Promise<ScoredWord[]> => {
    const synonyms: Array<{ word: string; score: number }> = await datamuse.request(`words?rel_syn=${input}`);

    const filteredSyns = synonyms
      .filter((synonym) => !synonym.word.includes(" "))
      .map(({ word, score }) => ({ word, score }));

    return filteredSyns;
  },
  {
    maxAge: 60 * 60,
    name: "synonyms",
    getKey: (input: string) => `synonyms:${input}`,
  },
);

const grabTranslation = cachedFunction(
  async (
    inputWord: string,
    inputLang: LanguageKey,
    outputLang: LanguageKey,
  ): Promise<Pick<Translation, "translated" | "translatedIPA">> => {
    try {
      const response = await translate(inputWord, { from: inputLang, to: outputLang });

      const ipa = await fetchIPA(response.text, outputLang);

      return {
        translated: response.text,
        translatedIPA: ipa,
      };
    } catch (e) {
      console.error("Error while translating", e);
    }

    throw "Error while translating";
  },
  {
    maxAge: 60 * 60,
    name: "translation",
    getKey: (input: string, lang: string) => `translation:${input}:${lang}`,
  },
);

const LanguageEnum = z.enum(Object.keys(ValidLanguages) as LanguageKey[]);
const ValidQuery = z.object({
  input: z.string(),
  outputLang: LanguageEnum,
  inputLang: LanguageEnum,
  synonymCount: z.coerce.number().optional(),
});
export default defineEventHandler(async (event): Promise<TranslateResponse> => {
  const query = getQuery<{
    input: string;
    outputLang: LanguageKey;
    inputLang: LanguageKey;
    synonymCount?: number; 
  }>(
    event,
  );

  const { input = null, inputLang, outputLang, synonymCount = 0 } = ValidQuery.parse(query);

  if (!input) {
    throw "Input required";
  }
  
  const splitInput = input.split(",");

  if (!inputLang) {
    throw "Input Language required";
  }
  if (!outputLang) {
    throw "Output Language required";
  }

  const inputLowercase = splitInput.map(str => str.toLowerCase().trim());

  const langKeys = outputLang.split(",") as LanguageKey[];

  const output: TranslateResponse = {};

  for (const word of inputLowercase) {
    const translated: Translation[] = [];
    const originalIPA = await fetchIPA(word, inputLang);

    for (const lang of langKeys) {
      const translatedWord = await grabTranslation(word, inputLang, lang);

      if (translatedWord) {
        translated.push({
          ...translatedWord,
          baseWord: word,
          original: word,
          originalIPA,
          lang,
          score: 10000,
        });
      }

      if (synonymCount > 0) {
        const synonyms = await grabSynonyms(word); // these have to be inputted in English

        const slicedSynonyms = (synonyms ?? []).slice(0, synonymCount);

        for (const synonymWord of slicedSynonyms) {
          const translatedSynonymWord = await grabTranslation(synonymWord.word, inputLang, lang);
          const synonymIPA = await fetchIPA(synonymWord.word, inputLang);

          if (translatedSynonymWord) {
            translated.push({
              ...translatedSynonymWord,
              baseWord: word,
              original: synonymWord.word,
              originalIPA: synonymIPA,
              score: synonymWord.score,
              lang,
            });
          }
        }
      }
    }
    
    if (!translated.length) {
      throw `Cannot translate ${word}`;
    }

    output[word] = translated;
  }

  return output;
});
