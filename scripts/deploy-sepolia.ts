#!/usr/bin/env node --experimental-strip-types
/**
 * Declare and deploy IntentRegistry + ExecutionVerifier to Starknet Sepolia.
 *
 * The script refuses to start unless it has everything it needs. A deployment
 * that half-completes leaves a declared class with no instance and an operator
 * guessing which step failed, so every precondition is checked up front and the
 * addresses are written to disk the moment they exist.
 *
 * Usage:
 *   pnpm build:cairo
 *   cp .env.example .env && $EDITOR .env
 *   pnpm deploy:sepolia
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Account, RpcProvider, type CompiledSierra, type CompiledSierraCasm } from 'starknet';

const HERE = dirname(fileURLToPath(import.meta.url));
const REPO = resolve(HERE, '..');
const TARGET = resolve(REPO, 'contracts/target/dev');

const DEFAULT_RPC = 'https://starknet-sepolia.drpc.org';
const EXPLORER = 'https://sepolia.starkscan.co';

function loadDotEnv(): void {
  for (const file of ['.env', '.env.local']) {
    const path = resolve(REPO, file);
    if (!existsSync(path)) continue;
    for (const line of readFileSync(path, 'utf8').split('\n')) {
      const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/u.exec(line);
      if (!match?.[1]) continue;
      const value = (match[2] ?? '').replace(/^["']|["']$/gu, '');
      if (value && !process.env[match[1]]) process.env[match[1]] = value;
    }
  }
}

function die(message: string, hint?: string): never {
  console.error(`\n  ✗ ${message}`);
  if (hint) console.error(`    ${hint}`);
  console.error('');
  process.exit(1);
}

function artifact(name: string): { sierra: CompiledSierra; casm: CompiledSierraCasm } {
  const sierraPath = resolve(TARGET, `intentproof_${name}.contract_class.json`);
  const casmPath = resolve(TARGET, `intentproof_${name}.compiled_contract_class.json`);
  if (!existsSync(sierraPath) || !existsSync(casmPath)) {
    die(
      `Missing build output for ${name}.`,
      'Run `pnpm build:cairo` (needs scarb) before deploying.',
    );
  }
  return {
    sierra: JSON.parse(readFileSync(sierraPath, 'utf8')) as CompiledSierra,
    casm: JSON.parse(readFileSync(casmPath, 'utf8')) as CompiledSierraCasm,
  };
}

async function main(): Promise<void> {
  loadDotEnv();

  const rpcUrl = process.env.STARKNET_RPC_URL ?? DEFAULT_RPC;
  const address = process.env.STARKNET_ACCOUNT_ADDRESS;
  const privateKey = process.env.STARKNET_PRIVATE_KEY;

  if (!address || !privateKey) {
    die(
      'STARKNET_ACCOUNT_ADDRESS and STARKNET_PRIVATE_KEY are required.',
      'Deploy an account with starkli or a wallet, fund it from the Starknet Sepolia faucet, then set both in .env.',
    );
  }

  console.log('\n  IntentProof — Starknet Sepolia deployment');
  console.log(`  rpc      ${rpcUrl}`);
  console.log(`  deployer ${address}\n`);

  const provider = new RpcProvider({ nodeUrl: rpcUrl });

  const chainId = await provider.getChainId().catch(() => {
    die(`Cannot reach the RPC endpoint at ${rpcUrl}.`, 'Check STARKNET_RPC_URL and your network.');
  });
  console.log(`  chain id ${chainId}`);

  const account = new Account({ provider, address, signer: privateKey });

  // Fail early and clearly rather than partway through a declare.
  const nonce = await account.getNonce().catch(() => {
    die(
      'The deployer account is not deployed on this network.',
      'Deploy the account contract first, then fund it. An undeployed address has no nonce.',
    );
  });
  console.log(`  nonce    ${nonce}\n`);

  const registryArtifacts = artifact('IntentRegistry');
  const verifierArtifacts = artifact('ExecutionVerifier');

  console.log('  → declaring IntentRegistry…');
  const registryDeclare = await account.declareIfNot({
    contract: registryArtifacts.sierra,
    casm: registryArtifacts.casm,
  });
  if (registryDeclare.transaction_hash) {
    await provider.waitForTransaction(registryDeclare.transaction_hash);
  }
  console.log(`    class hash ${registryDeclare.class_hash}`);

  console.log('  → deploying IntentRegistry…');
  const registryDeploy = await account.deployContract({
    classHash: registryDeclare.class_hash,
    constructorCalldata: [address], // owner
  });
  await provider.waitForTransaction(registryDeploy.transaction_hash);
  const registryAddress = registryDeploy.contract_address;
  console.log(`    address    ${registryAddress}`);
  console.log(`    tx         ${registryDeploy.transaction_hash}\n`);

  console.log('  → declaring ExecutionVerifier…');
  const verifierDeclare = await account.declareIfNot({
    contract: verifierArtifacts.sierra,
    casm: verifierArtifacts.casm,
  });
  if (verifierDeclare.transaction_hash) {
    await provider.waitForTransaction(verifierDeclare.transaction_hash);
  }
  console.log(`    class hash ${verifierDeclare.class_hash}`);

  console.log('  → deploying ExecutionVerifier…');
  const verifierDeploy = await account.deployContract({
    classHash: verifierDeclare.class_hash,
    constructorCalldata: [registryAddress],
  });
  await provider.waitForTransaction(verifierDeploy.transaction_hash);
  const verifierAddress = verifierDeploy.contract_address;
  console.log(`    address    ${verifierAddress}`);
  console.log(`    tx         ${verifierDeploy.transaction_hash}\n`);

  const record = {
    network: 'starknet-sepolia',
    chainId: String(chainId),
    rpcUrl,
    deployer: address,
    deployedAt: new Date().toISOString(),
    intentRegistry: {
      classHash: registryDeclare.class_hash,
      address: registryAddress,
      transactionHash: registryDeploy.transaction_hash,
      explorer: `${EXPLORER}/contract/${registryAddress}`,
    },
    executionVerifier: {
      classHash: verifierDeclare.class_hash,
      address: verifierAddress,
      transactionHash: verifierDeploy.transaction_hash,
      explorer: `${EXPLORER}/contract/${verifierAddress}`,
    },
  };

  const outPath = resolve(REPO, 'deployments/sepolia.json');
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, `${JSON.stringify(record, null, 2)}\n`, 'utf8');

  console.log(`  ✓ deployment recorded at deployments/sepolia.json\n`);
  console.log('  Add to .env.local:\n');
  console.log(`    INTENT_REGISTRY_ADDRESS=${registryAddress}`);
  console.log(`    EXECUTION_VERIFIER_ADDRESS=${verifierAddress}`);
  console.log(`    STARKNET_RPC_URL=${rpcUrl}`);
  console.log(`    NEXT_PUBLIC_STARKNET_NETWORK=sepolia\n`);
  console.log(`  Explorer: ${record.intentRegistry.explorer}\n`);
}

main().catch((error: unknown) => {
  console.error(`\n  ✗ Deployment failed: ${(error as Error).message}\n`);
  process.exit(1);
});
