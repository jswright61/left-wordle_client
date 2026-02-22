import esX from "eslint-plugin-es-x";

export default [
  esX.configs["flat/restrict-to-es2022"],
  {
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: "script",
      globals: {
        window: "readonly",
        document: "readonly",
        localStorage: "readonly",
        HTMLElement: "readonly",
        customElements: "readonly",
        CustomEvent: "readonly",
        setTimeout: "readonly",
        setInterval: "readonly",
        clearInterval: "readonly",
        console: "readonly",
        answer_list: "readonly",
        valid_guesses: "readonly",
        gtag: "readonly"
      }
    }
  }
];
