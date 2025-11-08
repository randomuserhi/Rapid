import { FlatCompat } from "@eslint/eslintrc";
import js from "@eslint/js";
import typescriptEslint from "@typescript-eslint/eslint-plugin";
import tsParser from "@typescript-eslint/parser";
import unusedImports from "eslint-plugin-unused-imports";
import { defineConfig } from "eslint/config";
import globals from "globals";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compat = new FlatCompat({
    baseDirectory: __dirname,
    recommendedConfig: js.configs.recommended,
    allConfig: js.configs.all
});

export default defineConfig([{
    extends: compat.extends("eslint:recommended", "plugin:@typescript-eslint/recommended"),

    plugins: {
        "@typescript-eslint": typescriptEslint,
        "unused-imports": unusedImports,
    },

    languageOptions: {
        globals: {
            ...globals.browser,
        },

        parser: tsParser,
        ecmaVersion: "latest",
        sourceType: "script",
    },

    rules: {
        "unused-imports/no-unused-imports": "error",
        "@typescript-eslint/no-this-alias": "off",
        "@typescript-eslint/no-namespace": "off",

        "brace-style": ["error", "1tbs", {
            allowSingleLine: true,
        }],

        "@typescript-eslint/no-explicit-any": "off",
        "@typescript-eslint/ban-types": "off",
        "no-unused-vars": "off",
        "@typescript-eslint/no-unused-vars": "warn",

        indent: ["error", 4, {
            SwitchCase: 0,
        }],

        "linebreak-style": ["error", "windows"],
        semi: "error"
    },
}]);