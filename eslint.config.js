import eslint from "@eslint/js";
import importPlugin from "eslint-plugin-import-x";
import prettierRecommended from "eslint-plugin-prettier/recommended";
import tseslint from "typescript-eslint";

const importPluginDisabled = process.env.IMPORT_PLUGIN_DISABLED === "true";
const typescriptFiles = ["src/**/*.ts", "tests/**/*.ts"];

const importConfigs = importPluginDisabled
    ? []
    : [
          {
              ...importPlugin.flatConfigs.errors,
              files: typescriptFiles,
          },
          {
              ...importPlugin.flatConfigs.warnings,
              files: typescriptFiles,
          },
          {
              ...importPlugin.flatConfigs.typescript,
              files: typescriptFiles,
          },
      ];

export default tseslint.config(
    {
        ignores: ["dist/**", "node_modules/**"],
    },
    {
        languageOptions: {
            globals: {
                process: "readonly",
            },
        },
    },
    eslint.configs.recommended,
    tseslint.configs.recommended,
    ...importConfigs,
    prettierRecommended,
    {
        files: typescriptFiles,
        languageOptions: {
            parserOptions: {
                ecmaVersion: 2021,
                project: ["./tsconfig.json"],
                sourceType: "module",
            },
        },
        rules: {
            "@typescript-eslint/explicit-member-accessibility": "error",
            "@typescript-eslint/member-ordering": [
                "error",
                { default: ["signature", "field", "constructor", "method"] },
            ],
            "@typescript-eslint/no-floating-promises": "error",
            "@typescript-eslint/no-unused-vars": [
                "warn",
                {
                    argsIgnorePattern: "^_",
                    varsIgnorePattern: "^_",
                },
            ],
            "@typescript-eslint/require-await": "warn",
            "@typescript-eslint/return-await": ["warn", "always"],
            "@typescript-eslint/await-thenable": "error",
            curly: ["error", "all"],
            "import-x/no-extraneous-dependencies": importPluginDisabled
                ? "off"
                : [
                      "warn",
                      {
                          devDependencies: true,
                          optionalDependencies: false,
                          peerDependencies: false,
                      },
                  ],
            "linebreak-style": ["error", "unix"],
            "max-len": ["error", { code: 120, ignorePattern: "^import .*" }],
            "padding-line-between-statements": ["error", { blankLine: "always", prev: "block-like", next: "function" }],
            quotes: ["error", "double", { avoidEscape: true }],
            semi: ["error", "always"],
        },
    },
);
