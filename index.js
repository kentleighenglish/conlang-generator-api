const translate = require("google-translate-api-x");
const datamuse = require("datamuse");
const z = require("zod");
const { fetchIPA } = require("./helpers/unalengua.js");

const { handleOptions, handleRequest } = require("./cors-proxy.js");

const cachedFunction = (func, opts) => {
  return async (...input) => {
    const key = opts.getKey(...input);

    // check cache

    const response = await func(...input);

    // cache response;

    return response;
  };
};

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
  async (inputWord, inputLang, outputLang) => {
    try {
      const response = await translate(inputWord, {
        from: inputLang,
        to: outputLang,
      });

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

const LanguageEnum = z.enum(["en", "de", "ru"]);
const ValidQuery = z.object({
  input: z.string(),
  outputLang: LanguageEnum,
  inputLang: LanguageEnum,
  synonymCount: z.coerce.number().optional(),
});

const translate = async (request) => {
  const { searchParams } = new URL(request.url);
  const query = Object.fromEntries(searchParams.entries());

  if (!query.input || !query.inputLang || !query.outputLang) {
    return new Response("[]");
  }

  const {
    input = null,
    inputLang,
    outputLang,
    synonymCount = 0,
  } = ValidQuery.parse(query);

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

  const inputLowercase = splitInput.map((str) => str.toLowerCase().trim());

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
          const translatedSynonymWord = await grabTranslation(
            synonymWord.word,
            inputLang,
            lang,
          );
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

  return new Response(JSON.stringify(output));
};

export default {
  async fetch(request) {
    const url = new URL(request.url);
    if (url.pathname.startsWith(PROXY_ENDPOINT)) {
      if (request.method === "OPTIONS") {
        // Handle CORS preflight requests
        return handleOptions(request);
      } else if (
        request.method === "GET" ||
        request.method === "HEAD" ||
        request.method === "POST"
      ) {
        // Handle requests to the API server
        return handleRequest(request);
      } else {
        return new Response(null, {
          status: 405,
          statusText: "Method Not Allowed",
        });
      }
    } else {
      return translate(request);
    }
  },
};
