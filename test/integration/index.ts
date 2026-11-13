import { run } from './framework';

export async function runSuite(): Promise<void> {
  const lines: string[] = [];
  const log = (line: string) => {
    lines.push(line);
    process.stdout.write(`${line}\n`);
  };
  const result = await run(log);
  for (const { title, error } of result.failed) {
    log(`\n✗ ${title}\n${error instanceof Error ? (error.stack ?? error.message) : String(error)}`);
  }
  log(`\n${result.passed} passing, ${result.failed.length} failing`);
  if (result.failed.length > 0) throw new Error(`${result.failed.length} integration test(s) failed`);
}
