import { useState, type KeyboardEvent } from 'react';
import { trackEvent } from '../analytics';
import { useInView } from '../hooks/useInView';

// ─── Types ────────────────────────────────────────────────────────────────────

type CodeLine = {
  content: string;
  color: 'code' | 'comment' | 'highlight';
};

const tabs = ['send.ts', 'scan.ts', 'withdraw.ts'] as const;
type Tab = (typeof tabs)[number];

// ─── Code content ─────────────────────────────────────────────────────────────

const codeByTab: Record<Tab, CodeLine[]> = {
  'send.ts': [
    {
      content:
        "import { bytesToHex, encodeStealthMetaAddress, generateStealthAddress } from '@wraith-protocol/sdk/chains/stellar'",
      color: 'code',
    },
    { content: '', color: 'code' },
    { content: 'declare const spendingPubKey: Uint8Array', color: 'code' },
    { content: 'declare const viewingPubKey: Uint8Array', color: 'code' },
    { content: '', color: 'code' },
    { content: '// Stellar recipients share st:xlm: stealth meta-addresses', color: 'comment' },
    {
      content: 'const metaAddress = encodeStealthMetaAddress(spendingPubKey, viewingPubKey)',
      color: 'highlight',
    },
    { content: '', color: 'code' },
    {
      content: '// generate a one-time Stellar G... address and announcement memo',
      color: 'comment',
    },
    {
      content: 'const stealth = generateStealthAddress(spendingPubKey, viewingPubKey)',
      color: 'code',
    },
    { content: 'const recipient = stealth.stealthAddress', color: 'highlight' },
    { content: 'const memo = bytesToHex(stealth.ephemeralPubKey)', color: 'code' },
  ],
  'scan.ts': [
    {
      content:
        "import { deriveStealthKeys, fetchAnnouncements, scanAnnouncements } from '@wraith-protocol/sdk/chains/stellar'",
      color: 'code',
    },
    { content: '', color: 'code' },
    { content: 'async function findPayments(walletSignature: Uint8Array) {', color: 'code' },
    { content: '  const keys = deriveStealthKeys(walletSignature)', color: 'code' },
    { content: "  const announcements = await fetchAnnouncements('stellar')", color: 'highlight' },
    { content: '', color: 'code' },
    { content: '  // derive viewing keys and scan Stellar announcements', color: 'comment' },
    { content: '  const matched = scanAnnouncements(', color: 'code' },
    {
      content: '    announcements, keys.viewingKey, keys.spendingPubKey, keys.spendingScalar',
      color: 'highlight',
    },
    { content: '  )', color: 'code' },
    { content: '  return matched.map((ann) => ann.stealthAddress)', color: 'code' },
    { content: '}', color: 'code' },
  ],
  'withdraw.ts': [
    {
      content:
        "import { deriveStealthPrivateScalar, hexToBytes, signStellarTransaction } from '@wraith-protocol/sdk/chains/stellar'",
      color: 'code',
    },
    { content: '', color: 'code' },
    {
      content: 'declare const keys: { spendingScalar: bigint; viewingKey: Uint8Array }',
      color: 'code',
    },
    {
      content: 'declare const ann: { ephemeralPubKey: string; stealthPubKeyBytes: Uint8Array }',
      color: 'code',
    },
    { content: 'declare const txHash: Uint8Array', color: 'code' },
    { content: '', color: 'code' },
    {
      content: '// derive the Stellar stealth scalar and sign a transaction hash',
      color: 'comment',
    },
    { content: 'const stealthScalar = deriveStealthPrivateScalar(', color: 'code' },
    {
      content: '  keys.spendingScalar, keys.viewingKey, hexToBytes(ann.ephemeralPubKey)',
      color: 'highlight',
    },
    { content: ')', color: 'code' },
    { content: '', color: 'code' },
    { content: 'const signature = signStellarTransaction(', color: 'code' },
    { content: '  txHash, stealthScalar, ann.stealthPubKeyBytes', color: 'highlight' },
    { content: '})', color: 'code' },
  ],
};

const colorMap = {
  code: 'text-on-surface-variant',
  comment: 'text-outline',
  highlight: 'text-primary',
};

export default function StellarCodePreview() {
  const [activeTab, setActiveTab] = useState<Tab>('send.ts');
  const [copyStatus, setCopyStatus] = useState<'idle' | 'copied' | 'failed'>('idle');
  const { ref: codeRef, isInView: codeInView } = useInView({ threshold: 0.1 });

  const activeTabIndex = tabs.indexOf(activeTab);
  const lines = codeByTab[activeTab];

  const handleTabChange = (tab: Tab) => {
    setActiveTab(tab);
    trackEvent('Stellar Code Tab Change', { props: { tab } });
  };

  const handleTabKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    let next = activeTabIndex;
    if (e.key === 'ArrowRight') next = (activeTabIndex + 1) % tabs.length;
    else if (e.key === 'ArrowLeft') next = (activeTabIndex - 1 + tabs.length) % tabs.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = tabs.length - 1;
    else return;
    e.preventDefault();
    const nextTab = tabs[next];
    if (!nextTab) return;
    setActiveTab(nextTab);
    requestAnimationFrame(() => {
      document.getElementById(`stellar-tab-${nextTab}`)?.focus();
    });
  };

  const handleCopy = async () => {
    const text = lines.map((l) => l.content).join('\n');
    try {
      await navigator.clipboard.writeText(text);
      setCopyStatus('copied');
    } catch {
      setCopyStatus('failed');
    }
    setTimeout(() => setCopyStatus('idle'), 2000);
  };

  return (
    <section ref={codeRef} className="border-b border-outline-variant-30 px-6 py-24 md:px-12">
      <div className="mx-auto max-w-336 flex flex-col gap-8" data-reveal={codeInView}>
        <div className="flex flex-col gap-3">
          <span className="font-mono text-[10px] font-semibold uppercase tracking-[2px] text-outline">
            SDK
          </span>
          <h2 className="font-heading text-[28px] font-bold tracking-[-1.2px] text-on-surface sm:text-[40px]">
            Code examples
          </h2>
          <p className="font-body text-[14px] leading-[1.6] text-on-surface-variant max-w-xl">
            All functions are tree-shakeable and typed. Import only what you need from{' '}
            <code className="font-mono text-[13px] text-primary">
              @wraith-protocol/sdk/chains/stellar
            </code>
            .
          </p>
        </div>

        <div className="flex flex-col">
          <div className="flex items-center justify-between border border-b-0 border-outline-variant bg-surface-container px-4 py-3">
            <div
              className="flex items-center gap-0"
              role="tablist"
              aria-label="Stellar code examples"
            >
              {tabs.map((tab) => (
                <button
                  key={tab}
                  id={`stellar-tab-${tab}`}
                  role="tab"
                  aria-selected={activeTab === tab}
                  aria-controls={`stellar-panel-${tab}`}
                  tabIndex={activeTab === tab ? 0 : -1}
                  onClick={() => handleTabChange(tab)}
                  onKeyDown={handleTabKeyDown}
                  className={`flex items-center justify-center px-3 py-1.5 transition-colors duration-150 ${
                    activeTab === tab
                      ? 'bg-surface-bright'
                      : 'hover:bg-surface-bright/50 cursor-pointer'
                  }`}
                >
                  <span
                    className={`font-mono text-[11px] ${
                      activeTab === tab ? 'font-medium text-on-surface' : 'text-outline'
                    }`}
                  >
                    {tab}
                  </span>
                </button>
              ))}
            </div>
            <button
              type="button"
              onClick={handleCopy}
              aria-label={`Copy ${activeTab} to clipboard`}
              className="flex cursor-pointer items-center gap-1.5 px-2 py-1 transition-colors duration-150 hover:opacity-80"
            >
              <span className="font-mono text-[10px] font-semibold tracking-[1px] text-outline">
                {copyStatus === 'copied' && 'COPIED'}
                {copyStatus === 'failed' && 'FAILED'}
                {copyStatus === 'idle' && 'COPY'}
              </span>
            </button>
            <span className="sr-only" aria-live="polite">
              {copyStatus === 'copied' && `${activeTab} copied to clipboard`}
              {copyStatus === 'failed' && `Failed to copy ${activeTab}`}
            </span>
          </div>

          <div
            id={`stellar-panel-${activeTab}`}
            role="tabpanel"
            aria-labelledby={`stellar-tab-${activeTab}`}
            className="overflow-x-auto border border-outline-variant bg-surface-container p-6"
          >
            <div className="w-max min-w-full">
              {lines.map((line, i) => (
                <div key={`${activeTab}-${i}`} className="flex gap-4 py-1">
                  <span
                    className="w-4 shrink-0 font-mono text-xs text-outline select-none"
                    aria-hidden="true"
                  >
                    {i + 1}
                  </span>
                  <span className={`whitespace-pre font-mono text-[13px] ${colorMap[line.color]}`}>
                    {line.content || ' '}
                  </span>
                </div>
              ))}
            </div>
          </div>

          <div className="flex items-center justify-between border border-t-0 border-outline-variant bg-surface-container px-4 py-3">
            <div className="flex items-center gap-2">
              <span className="h-1.5 w-1.5 rounded-full bg-tertiary" />
              <span className="font-mono text-[11px] text-on-surface-variant">
                npm install @wraith-protocol/sdk
              </span>
            </div>
            <span className="font-mono text-[10px] font-semibold tracking-[1.5px] text-outline">
              TYPESCRIPT
            </span>
          </div>
        </div>
      </div>
    </section>
  );
}
