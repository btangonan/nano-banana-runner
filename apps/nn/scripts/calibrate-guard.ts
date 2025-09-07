#!/usr/bin/env node

/**
 * Calibrate style guard thresholds using a dataset of known copies vs originals
 * Finds optimal Hamming distance threshold to minimize false positives/negatives
 */

import { readFile, readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';
import { pHash64, hamming, saveGuardConfig } from '../src/core/styleGuard.js';
import { createOperationLogger } from '../src/logger.js';

const log = createOperationLogger('calibrate-guard');

interface CalibrationPair {
  original: string;
  generated: string;
  isCopy: boolean;
}

interface CalibrationResult {
  threshold: number;
  truePositives: number;
  falsePositives: number;
  trueNegatives: number;
  falseNegatives: number;
  accuracy: number;
  fpr: number;  // False positive rate
  fnr: number;  // False negative rate
}

/**
 * Load calibration dataset
 * Expected structure:
 * - calibration/copies/*.png (known style copies)
 * - calibration/originals/*.png (acceptable style transfers)
 * - calibration/references/*.png (style references)
 */
async function loadDataset(baseDir: string): Promise<CalibrationPair[]> {
  const pairs: CalibrationPair[] = [];
  
  try {
    // Load reference images
    const refDir = join(baseDir, 'references');
    const refFiles = await readdir(refDir);
    const references = refFiles
      .filter(f => ['.png', '.jpg', '.jpeg'].includes(extname(f).toLowerCase()))
      .map(f => join(refDir, f));
    
    if (references.length === 0) {
      throw new Error('No reference images found in calibration/references/');
    }
    
    // Load copies (should be flagged as too similar)
    const copyDir = join(baseDir, 'copies');
    const copyFiles = await readdir(copyDir);
    for (const file of copyFiles) {
      if (['.png', '.jpg', '.jpeg'].includes(extname(file).toLowerCase())) {
        // Pair each copy with all references
        for (const ref of references) {
          pairs.push({
            original: ref,
            generated: join(copyDir, file),
            isCopy: true
          });
        }
      }
    }
    
    // Load originals (should pass as acceptable)
    const origDir = join(baseDir, 'originals');
    const origFiles = await readdir(origDir);
    for (const file of origFiles) {
      if (['.png', '.jpg', '.jpeg'].includes(extname(file).toLowerCase())) {
        // Pair each original with all references
        for (const ref of references) {
          pairs.push({
            original: ref,
            generated: join(origDir, file),
            isCopy: false
          });
        }
      }
    }
    
    log.info({ 
      references: references.length,
      copies: copyFiles.length,
      originals: origFiles.length,
      totalPairs: pairs.length 
    }, 'Loaded calibration dataset');
    
    return pairs;
    
  } catch (error) {
    log.error({ error }, 'Failed to load calibration dataset');
    throw new Error(
      'Calibration dataset not found. Expected structure:\n' +
      '  calibration/references/*.png (style references)\n' +
      '  calibration/copies/*.png (known copies to reject)\n' +
      '  calibration/originals/*.png (acceptable transfers)'
    );
  }
}

/**
 * Evaluate a threshold against the dataset
 */
async function evaluateThreshold(
  pairs: CalibrationPair[],
  threshold: number
): Promise<CalibrationResult> {
  let truePositives = 0;   // Correctly identified copies
  let falsePositives = 0;  // Incorrectly flagged as copies
  let trueNegatives = 0;   // Correctly identified as different
  let falseNegatives = 0;  // Missed copies
  
  for (const pair of pairs) {
    const origBuffer = await readFile(pair.original);
    const genBuffer = await readFile(pair.generated);
    
    const origHash = await pHash64(origBuffer);
    const genHash = await pHash64(genBuffer);
    const distance = hamming(origHash, genHash);
    
    const predictedCopy = distance <= threshold;
    
    if (pair.isCopy && predictedCopy) {
      truePositives++;
    } else if (!pair.isCopy && predictedCopy) {
      falsePositives++;
    } else if (!pair.isCopy && !predictedCopy) {
      trueNegatives++;
    } else if (pair.isCopy && !predictedCopy) {
      falseNegatives++;
    }
  }
  
  const total = pairs.length;
  const accuracy = (truePositives + trueNegatives) / total;
  const fpr = falsePositives / (falsePositives + trueNegatives) || 0;
  const fnr = falseNegatives / (falseNegatives + truePositives) || 0;
  
  return {
    threshold,
    truePositives,
    falsePositives,
    trueNegatives,
    falseNegatives,
    accuracy: Math.round(accuracy * 100),
    fpr: Math.round(fpr * 100),
    fnr: Math.round(fnr * 100)
  };
}

/**
 * Find optimal threshold through grid search
 */
async function findOptimalThreshold(
  pairs: CalibrationPair[]
): Promise<CalibrationResult> {
  const thresholds = [];
  
  // Test thresholds from 0 to 32 (half the bits)
  for (let t = 0; t <= 32; t++) {
    thresholds.push(t);
  }
  
  log.info(`Testing ${thresholds.length} threshold values...`);
  
  const results: CalibrationResult[] = [];
  for (const threshold of thresholds) {
    const result = await evaluateThreshold(pairs, threshold);
    results.push(result);
    
    log.debug({
      threshold,
      accuracy: `${result.accuracy}%`,
      fpr: `${result.fpr}%`,
      fnr: `${result.fnr}%`
    }, 'Evaluated threshold');
  }
  
  // Find best threshold (minimize false positives while keeping false negatives low)
  // Weight: accuracy 60%, low FPR 30%, low FNR 10%
  let bestResult = results[0]!;
  let bestScore = 0;
  
  for (const result of results) {
    // Penalize high false positive rates more than false negatives
    // (better to occasionally miss a copy than reject good generations)
    const score = result.accuracy * 0.6 + 
                  (100 - result.fpr) * 0.3 + 
                  (100 - result.fnr) * 0.1;
    
    if (score > bestScore) {
      bestScore = score;
      bestResult = result;
    }
  }
  
  return bestResult;
}

/**
 * Main calibration routine
 */
async function calibrate(): Promise<void> {
  const startTime = Date.now();
  log.info('Starting style guard calibration');
  
  // Load dataset
  const baseDir = process.argv[2] || 'calibration';
  const pairs = await loadDataset(baseDir);
  
  if (pairs.length < 20) {
    log.warn('Dataset has fewer than 20 pairs - results may not be reliable');
  }
  
  // Find optimal threshold
  const optimal = await findOptimalThreshold(pairs);
  
  // Display results
  console.log('\n📊 Calibration Results:');
  console.log(`   Optimal threshold: ${optimal.threshold}`);
  console.log(`   Accuracy: ${optimal.accuracy}%`);
  console.log(`   False positive rate: ${optimal.fpr}%`);
  console.log(`   False negative rate: ${optimal.fnr}%`);
  console.log('\n   Confusion Matrix:');
  console.log(`   True Positives:  ${optimal.truePositives} (correctly caught copies)`);
  console.log(`   True Negatives:  ${optimal.trueNegatives} (correctly allowed originals)`);
  console.log(`   False Positives: ${optimal.falsePositives} (incorrectly rejected originals)`);
  console.log(`   False Negatives: ${optimal.falseNegatives} (missed copies)`);
  
  // Save configuration
  const configPath = join(process.cwd(), 'guard-config.json');
  await saveGuardConfig(
    { hammingMax: optimal.threshold },
    configPath
  );
  
  const elapsed = Date.now() - startTime;
  console.log(`\n✅ Calibration complete in ${elapsed}ms`);
  console.log(`   Configuration saved to: ${configPath}`);
  console.log(`   Recommended threshold: ${optimal.threshold}`);
  
  // Provide recommendations
  if (optimal.fpr > 20) {
    console.log('\n⚠️  High false positive rate detected');
    console.log('   Consider increasing dataset size or adjusting weights');
  }
  
  if (optimal.fnr > 10) {
    console.log('\n⚠️  High false negative rate detected');  
    console.log('   Some copies may not be caught - consider stricter threshold');
  }
}

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  calibrate().catch(error => {
    log.error({ error }, 'Calibration failed');
    console.error('\n❌ Calibration failed:', error.message);
    process.exit(1);
  });
}

export { calibrate, CalibrationResult };