import { green, grey, red } from 'chalk';
import { Command } from 'commander';
import { join } from 'path';
import { argv } from 'process';
import { concat, merge, of, pipe } from 'rxjs';
import { ignoreElements, map, takeUntil } from 'rxjs/operators';

import { version } from '../package.json';
import { sync } from './sync';

// verbose
const stdOutVerbose = map<string[], void>((line) => console.log(grey(...line)));
const stdErrVerbose = map<string, void>((line) => console.error(red(line)));
const stdVerbose = pipe(
  map<string[], void>((line) => console.log(green(join(...line)))),
  ignoreElements()
);

// quiet
const stdOutQuiet = ignoreElements();
const stdErrQuiet = ignoreElements();
const stdQuiet = ignoreElements();

// exectue
const program = new Command();
program
  .version(version)
  .name("cbt")
  .description("simple backup utility")
  .arguments("<source> <target>")
  .option("-v, --verbose", "verbose output", false)
  .option("-q, --quiet", "quiet output", false)
  .action((src: string, dst: string) => {
    // check verbose output
    const bVerbose = !!program.verbose;
    const bQuiet = !!program.quiet;
    // sync result
    const { file$, stdout$, stderr$ } = sync(src, dst);
    // filters
    const outFilter = bVerbose ? stdOutVerbose : stdOutQuiet;
    const errFilter = bVerbose ? stdErrVerbose : stdErrQuiet;
    const stdFilter = bQuiet ? stdQuiet : stdVerbose;
    // attach
    const out$ = stdout$.pipe(outFilter);
    const err$ = stderr$.pipe(errFilter);
    const line$ = file$.pipe(stdFilter);
    // start debugging
    const done$ = concat(line$, of(true));
    // merge everything
    return merge(out$, err$).pipe(takeUntil(done$)).toPromise();
  })
  .parse(argv);
