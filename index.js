import translate from "google-translate-api-x";
import datamuse from "datamuse";
import * as z from "zod";
import { fetchIPA } from "./helpers/unalengua.js";

const cachedFunction = (func, opts) => {
    return async (input) => {
        const key = opts.getKey(input);

        // check cache
        
        const response = await func(input);

        // cache response;

        return response;
    }
}

const grabSynonyms = cachedFunction(
  async (input) => {
    const synonyms = await datamuse.request(`words?rel_syn=${input}`);

    const filteredSyns = synonyms
      .filter((synonym) => !synonym.word.includes(" "))
      .map(({ word, score }) => ({ word, score }));

    return filteredSyns;
  },
  {
    maxAge: 60 * 60,
    name: "synonyms",
    getKey: (input) => `synonyms:${input}`,
  },
);

const grabTranslation = cachedFunction(
  async (
    inputWord,
    inputLang,
    outputLang,
  ) => {
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
    getKey: (input, lang) => `translation:${input}:${lang}`,
  },
);

const LanguageEnum = z.enum(Object.keys(ValidLanguages));
const ValidQuery = z.object({
  input: z.string(),
  outputLang: LanguageEnum,
  inputLang: LanguageEnum,
  synonymCount: z.coerce.number().optional(),
});
export default defineEventHandler(async (event) => {
  const query = getQuery(event);

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

  const langKeys = outputLang.split(",");

  const output = {};

  for (const word of inputLowercase) {
    const translated = [];
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
