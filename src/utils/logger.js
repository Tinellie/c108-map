import chalk from "chalk";

function now() {
  return new Date().toISOString();
}

export function logStep(message, details) {
  const base = `${chalk.cyan("[STEP]")} ${chalk.gray(now())} ${message}`;
  if (details) {
    console.log(`${base} ${chalk.gray(details)}`);
    return;
  }
  console.log(base);
}

export function logInfo(message, details) {
  const base = `${chalk.blue("[INFO]")} ${chalk.gray(now())} ${message}`;
  if (details) {
    console.log(`${base} ${chalk.gray(details)}`);
    return;
  }
  console.log(base);
}

export function logSuccess(message, details) {
  const base = `${chalk.green("[OK]")} ${chalk.gray(now())} ${message}`;
  if (details) {
    console.log(`${base} ${chalk.gray(details)}`);
    return;
  }
  console.log(base);
}

export function logWarn(message, details) {
  const base = `${chalk.yellow("[WARN]")} ${chalk.gray(now())} ${message}`;
  if (details) {
    console.warn(`${base} ${chalk.gray(details)}`);
    return;
  }
  console.warn(base);
}

export function logError(message, error) {
  console.error(`${chalk.red("[ERR]")} ${chalk.gray(now())} ${message}`);
  if (error) {
    console.error(error);
  }
}

export function formatDurationMs(startNs) {
  const elapsedNs = process.hrtime.bigint() - startNs;
  return `${(Number(elapsedNs) / 1e6).toFixed(1)}ms`;
}

export function logSubStep(message, details) {
  const line = `  |- ${message}`;
  logInfo(line, details);
}
