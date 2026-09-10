// fitness/a-fitness-function-is-one-claim.fitness.ts
// Added check: every export of fitness/lib/*.ts must be imported by a *.fitness.ts 
// or be a type named by the signature of an exported reader.

export function checkLibExportsRule(projectFiles: ProjectFile[]): Fault[] {
  const faults: Fault[] = [];
  const libExports = getLibExports(projectFiles);
  const fitnessImports = getFitnessImports(projectFiles);
  const exportedReaderSignatures = getExportedReaderSignatures(projectFiles);

  for (const exp of libExports) {
    const isImported = fitnessImports.has(exp.name);
    const isUsedInReaderSig = exportedReaderSignatures.has(exp.name);

    if (!isImported && !isUsedInReaderSig) {
      faults.push({
        kind: 'unreferenced-lib-export',
        message: `Export '${exp.name}' from ${exp.file} is neither imported by a *.fitness.ts nor named in an exported reader signature.`
      });
    }
  }

  return faults;
}