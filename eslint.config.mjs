// Same checks as the Obsidian community review: ESLint + type-checked typescript-eslint + Obsidian guideline rules.
import { defineConfig, globalIgnores } from "eslint/config";
import obsidianmd from "eslint-plugin-obsidianmd";

export default defineConfig([
	globalIgnores(["node_modules", "main.js", "esbuild.config.mjs", "helper", "docs"]),
	...obsidianmd.configs.recommended,
	{
		languageOptions: {
			parserOptions: {
				projectService: { allowDefaultProject: ["eslint.config.*"] },
			},
		},
	},
]);
