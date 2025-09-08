import { Command } from 'commander';
import { z } from 'zod';
import { loadEnv } from './config/env.js';
import { runAnalyze } from './workflows/runAnalyze.js';
import { runRemix } from './workflows/runRemix.js';
import { runRender } from './workflows/runRender.js';
import { runProbe } from './workflows/runProbe.js';
import { runBatchSubmit } from './workflows/runBatchSubmit.js';
import { runBatchPoll } from './workflows/runBatchPoll.js';
import { runBatchFetch } from './workflows/runBatchFetch.js';
import { runBatchCancel } from './workflows/runBatchCancel.js';
import { runExperimentCommand } from './workflows/runBatchExperiment.js';
import { createProblem } from './types.js';

const program = new Command()
  .name('nn')
  .description('Nano Banana Runner CLI - Image analyzer → prompt remixer → Gemini generator')
  .version('1.0.0');

program
  .command('analyze')
  .description('Extract metadata, palette, and attributes from images')
  .requiredOption('--in <dir>', 'input images directory')
  .option('--out <file>', 'descriptors output file', 'artifacts/descriptors.json')
  .option('--concurrency <n>', 'parallel workers (1-10)', '4')
  .action(async (opts) => {
    try {
      loadEnv();
      
      const concurrency = parseInt(opts.concurrency, 10);
      if (isNaN(concurrency) || concurrency < 1 || concurrency > 10) {
        throw new Error('Concurrency must be a number between 1 and 10');
      }

      await runAnalyze({ 
        inDir: opts.in, 
        outPath: opts.out, 
        concurrency 
      });
      
    } catch (error) {
      const problem = createProblem(
        'Analysis failed',
        String((error as Error)?.message ?? error),
        500
      );
      console.error(JSON.stringify(problem, null, 2));
      process.exit(1);
    }
  });

program
  .command('remix')
  .description('Generate prompt variations with deterministic control')
  .requiredOption('--descriptors <file>', 'descriptors.json input file')
  .option('--out <file>', 'prompts JSONL output file', 'artifacts/prompts.jsonl')
  .option('--max-per-image <n>', 'maximum prompts per image (1-100)', '50')
  .option('--seed <n>', 'deterministic seed for reproducible output', '42')
  .action(async (opts) => {
    try {
      loadEnv();
      
      const maxPerImage = parseInt(opts.maxPerImage, 10);
      if (isNaN(maxPerImage) || maxPerImage < 1 || maxPerImage > 100) {
        throw new Error('Max per image must be a number between 1 and 100');
      }
      
      const seed = parseInt(opts.seed, 10);
      if (isNaN(seed)) {
        throw new Error('Seed must be a valid number');
      }

      await runRemix({
        descriptorsPath: opts.descriptors,
        outPath: opts.out,
        maxPerImage,
        seed
      });
      
    } catch (error) {
      const problem = createProblem(
        'Remix failed',
        String((error as Error)?.message ?? error),
        500
      );
      console.error(JSON.stringify(problem, null, 2));
      process.exit(1);
    }
  });

program
  .command('probe')
  .description('Verify Vertex AI connectivity and model availability')
  .action(async () => {
    try {
      loadEnv();
      
      const result = await runProbe();
      
      // Exit with appropriate code
      if (result.auth === 'ok' && result.model === 'reachable') {
        process.exit(0);
      } else {
        process.exit(1);
      }
      
    } catch (error) {
      const problem = createProblem(
        'Probe failed',
        String((error as Error)?.message ?? error),
        503
      );
      console.error(JSON.stringify(problem, null, 2));
      process.exit(1);
    }
  });

program
  .command('render')
  .description('Generate images using Gemini 2.5 Flash with style-only conditioning')
  .requiredOption('--prompts <file>', 'prompts JSONL input file')
  .requiredOption('--style-dir <dir>', 'style reference images directory')
  .option('--out <dir>', 'rendered images output directory', 'artifacts/renders')
  .option('--variants <n>', 'variants per prompt (1-3)', '1')
  .option('--concurrency <n>', 'parallel requests (1-4)', '2')
  .option('--dry-run', 'cost estimate only (default behavior)', true)
  .option('--live', 'perform actual generation (requires --yes)', false)
  .option('--yes', 'confirm spending for live generation', false)
  .action(async (opts) => {
    try {
      loadEnv();
      
      const variants = parseInt(opts.variants, 10);
      if (isNaN(variants) || variants < 1 || variants > 3) {
        throw new Error('Variants must be a number between 1 and 3');
      }
      
      const concurrency = parseInt(opts.concurrency, 10);
      if (isNaN(concurrency) || concurrency < 1 || concurrency > 4) {
        throw new Error('Concurrency must be a number between 1 and 4');
      }
      
      // Determine run mode: dry-run is default, --live overrides it
      const dryRun = opts.live ? false : true;
      
      // Safety check: live generation requires explicit confirmation
      if (!dryRun && !opts.yes) {
        const problem = createProblem(
          'Live render requires confirmation',
          'Add --yes flag to proceed with actual image generation and billing',
          400
        );
        console.error(JSON.stringify(problem, null, 2));
        process.exit(2);
      }

      await runRender({
        promptsPath: opts.prompts,
        styleDir: opts.styleDir,
        outDir: opts.out,
        variants,
        concurrency,
        dryRun
      });
      
    } catch (error) {
      const problem = createProblem(
        'Render failed',
        String((error as Error)?.message ?? error),
        500
      );
      console.error(JSON.stringify(problem, null, 2));
      process.exit(1);
    }
  });

// Batch commands
const batch = program.command('batch')
  .description('Batch image generation commands');

batch
  .command('submit')
  .description('Submit a batch job for image generation')
  .requiredOption('--prompts <file>', 'prompts JSONL input file')
  .option('--style-dir <dir>', 'style reference images directory (legacy)')
  .option('--refs <file>', 'reference pack YAML/JSON file')
  .option('--ref-mode <mode>', 'reference mode: style|prop|subject|pose|environment|mixed', 'style')
  .option('--provider <name>', 'provider override: batch|vertex (overrides default)')
  .option('--variants <n>', 'variants per prompt (1-3)', '1')
  .option('--dry-run', 'estimate only (default)', true)
  .option('--live', 'submit actual job', false)
  .option('--yes', 'confirm spending', false)
  .option('--no-compress', 'disable reference image compression', false)
  .option('--no-split', 'fail on budget breach instead of splitting', false)
  .action(async (opts) => {
    try {
      loadEnv();
      
      // Validate variants
      const variants = parseInt(opts.variants, 10);
      if (isNaN(variants) || variants < 1 || variants > 3) {
        throw new Error('Variants must be 1, 2, or 3');
      }
      
      // Validate ref mode
      const validModes = ['style', 'prop', 'subject', 'pose', 'environment', 'mixed'];
      if (!validModes.includes(opts.refMode)) {
        throw new Error(`Invalid ref-mode: ${opts.refMode}. Must be one of: ${validModes.join(', ')}`);
      }
      
      // Validate provider override if provided
      const ProviderEnum = z.enum(['batch', 'vertex']);
      const provider = opts.provider ? ProviderEnum.parse(opts.provider) : undefined;
      
      // Check for refs specification
      if (!opts.refs && !opts.styleDir) {
        throw new Error('Either --refs or --style-dir must be specified');
      }
      
      const dryRun = opts.live ? false : true;
      
      if (!dryRun && !opts.yes) {
        const problem = createProblem(
          'Batch submission requires confirmation',
          'Add --yes flag to proceed with actual job submission',
          400
        );
        console.error(JSON.stringify(problem, null, 2));
        process.exit(2);
      }
      
      await runBatchSubmit({
        provider,
        promptsPath: opts.prompts,
        styleDir: opts.styleDir,
        refsPath: opts.refs,
        refMode: opts.refMode as any,
        variants: variants as 1 | 2 | 3,
        compress: opts.compress !== false, // Handle --no-compress
        split: opts.split !== false, // Handle --no-split
        dryRun
      });
      
    } catch (error) {
      const problem = createProblem(
        'Batch submit failed',
        String((error as Error)?.message ?? error),
        500
      );
      console.error(JSON.stringify(problem, null, 2));
      process.exit(1);
    }
  });

batch
  .command('poll')
  .description('Poll batch job status')
  .requiredOption('--job <id>', 'job ID to poll')
  .option('--watch', 'keep polling until complete', false)
  .action(async (opts) => {
    try {
      loadEnv();
      
      await runBatchPoll({
        jobId: opts.job,
        watch: opts.watch
      });
      
    } catch (error) {
      const problem = createProblem(
        'Batch poll failed',
        String((error as Error)?.message ?? error),
        500
      );
      console.error(JSON.stringify(problem, null, 2));
      process.exit(1);
    }
  });

batch
  .command('fetch')
  .description('Fetch batch job results')
  .requiredOption('--job <id>', 'job ID to fetch')
  .option('--out <dir>', 'output directory', 'artifacts/renders')
  .action(async (opts) => {
    try {
      loadEnv();
      
      await runBatchFetch({
        jobId: opts.job,
        outDir: opts.out
      });
      
    } catch (error) {
      const problem = createProblem(
        'Batch fetch failed',
        String((error as Error)?.message ?? error),
        500
      );
      console.error(JSON.stringify(problem, null, 2));
      process.exit(1);
    }
  });

batch
  .command('cancel')
  .description('Cancel batch job')
  .requiredOption('--job <id>', 'job ID to cancel')
  .action(async (opts) => {
    try {
      loadEnv();
      
      await runBatchCancel({
        jobId: opts.job
      });
      
    } catch (error) {
      const problem = createProblem(
        'Batch cancel failed',
        String((error as Error)?.message ?? error),
        500
      );
      console.error(JSON.stringify(problem, null, 2));
      process.exit(1);
    }
  });

batch
  .command('resume')
  .description('Resume batch job (poll and fetch if complete)')
  .requiredOption('--job <id>', 'job ID to resume')
  .option('--out <dir>', 'output directory', 'artifacts/renders')
  .action(async (opts) => {
    try {
      loadEnv();
      
      // Poll first
      const status = await runBatchPoll({
        jobId: opts.job,
        watch: false
      });
      
      // If complete, fetch
      if (status === 'succeeded' || status === 'failed') {
        await runBatchFetch({
          jobId: opts.job,
          outDir: opts.out
        });
      } else {
        console.log(`Job ${opts.job} is ${status}, use --watch to wait for completion`);
      }
      
    } catch (error) {
      const problem = createProblem(
        'Batch resume failed',
        String((error as Error)?.message ?? error),
        500
      );
      console.error(JSON.stringify(problem, null, 2));
      process.exit(1);
    }
  });

batch
  .command('experiment')
  .description('Run mini experiment to test multi-ref support')
  .requiredOption('--prompts <file>', 'prompts JSONL input file')
  .requiredOption('--refs <file>', 'reference pack YAML/JSON file')
  .option('--ref-mode <mode>', 'reference mode: style|prop|subject|pose|environment|mixed', 'mixed')
  .action(async (opts) => {
    try {
      loadEnv();
      
      await runExperimentCommand({
        promptsPath: opts.prompts,
        refsPath: opts.refs,
        refMode: opts.refMode
      });
      
    } catch (error) {
      const problem = createProblem(
        'Batch experiment failed',
        String((error as Error)?.message ?? error),
        500
      );
      console.error(JSON.stringify(problem, null, 2));
      process.exit(1);
    }
  });

// Global error handling
program.parseAsync().catch((error) => {
  const problem = createProblem(
    'CLI execution failed',
    String(error?.message ?? error),
    500
  );
  console.error(JSON.stringify(problem, null, 2));
  process.exit(1);
});