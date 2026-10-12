import { writeFile } from 'fs/promises';
import * as mongoose from 'mongoose';
import { env } from '../common/config/env.config';
import {
  Finding,
  IntegrityReport,
  runIntegrityChecks,
} from './integrity/integrity-checks';

/**
 * Read-only integrity report. CLI entry: `npm run db:check` (dev) or
 * `node dist/database/db-check` (prod).
 *
 *   --all          print every offending id (default: first 20 per check)
 *   --json <file>  also write the full report as JSON
 *   --strict       exit 1 on warnings too (default: errors only)
 *
 * Prints the target host and database name, never the connection string.
 */
const SAMPLE = 20;

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i === -1 ? undefined : process.argv[i + 1];
}

function printFinding(f: Finding, all: boolean): void {
  const shown = all ? f.ids : f.ids.slice(0, SAMPLE);
  console.log(
    `  [${f.severity.toUpperCase()}] ${f.check}: ${f.ids.length} — ${
      f.description
    }`,
  );
  console.log(
    `      ${shown.join(', ')}${
      shown.length < f.ids.length ? `, … (+${f.ids.length - shown.length})` : ''
    }`,
  );
}

function printReport(report: IntegrityReport, all: boolean): void {
  console.log('\nCollections:');
  for (const [name, count] of Object.entries(report.collections)) {
    const unmanaged = report.unmanagedCollections.includes(name)
      ? '  (no schema in code)'
      : '';
    console.log(
      `  ${name.padEnd(22)} ${String(count).padStart(7)}${unmanaged}`,
    );
  }

  const byCollection = new Map<string, Finding[]>();
  for (const f of report.findings) {
    byCollection.set(f.collection, [
      ...(byCollection.get(f.collection) ?? []),
      f,
    ]);
  }
  console.log('\nFindings:');
  if (!report.findings.length) console.log('  none');
  for (const [collection, findings] of byCollection) {
    console.log(`\n${collection}`);
    findings.forEach((f) => printFinding(f, all));
  }

  const totals = { error: 0, warning: 0, info: 0 };
  report.findings.forEach((f) => (totals[f.severity] += f.ids.length));
  console.log(
    `\nSummary: ${totals.error} error, ${totals.warning} warning, ${totals.info} info document(s)`,
  );
}

async function main(): Promise<void> {
  if (!env.mongoUri) throw new Error('MONGO_URI is not set');
  const connection = await mongoose.connect(env.mongoUri);
  try {
    const { host, name } = connection.connection;
    console.log(`Target: host ${host}, database ${name} (read-only)`);

    const report = await runIntegrityChecks(connection.connection.db);
    printReport(report, process.argv.includes('--all'));

    const jsonPath = arg('--json');
    if (jsonPath) {
      await writeFile(
        jsonPath,
        JSON.stringify(
          { target: { host, database: name }, at: new Date(), ...report },
          null,
          2,
        ),
      );
      console.log(`Report written to ${jsonPath}`);
    }

    const failOn = process.argv.includes('--strict')
      ? ['error', 'warning']
      : ['error'];
    if (report.findings.some((f) => failOn.includes(f.severity))) {
      process.exitCode = 1;
    }
  } finally {
    await connection.disconnect();
  }
}

main().catch((error) => {
  console.error('Integrity check failed to run', error);
  process.exit(2);
});
