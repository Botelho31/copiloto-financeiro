import { applyCategoryRule } from "../services/categorization";

const [, , matchTextArg, categoryNameArg] = process.argv;

if (!matchTextArg || !categoryNameArg) {
  console.error('Usage: bun run categorize -- "<match text>" "<Category Name>"');
  console.error('Example: bun run categorize -- "uber" "Transport"');
  process.exit(1);
}

try {
  const { matchText, updated } = applyCategoryRule(matchTextArg, categoryNameArg);
  console.log(
    `Rule "${matchText}" -> "${categoryNameArg}" saved. ${updated} existing transaction(s) recategorized.`
  );
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
