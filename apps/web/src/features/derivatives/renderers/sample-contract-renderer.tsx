import type { DerivativeDetail } from '../types';
import { GatedNotice } from './gated-notice';
import { Unavailable } from './unavailable';

interface ContractParty {
  role?: string;
  name?: string;
  address?: string;
}

interface ContractSubclause {
  heading?: string;
  text?: string;
}

interface ContractClause {
  heading?: string;
  text?: string;
  subclauses?: ContractSubclause[];
}

interface ContractSchedule {
  heading?: string;
  text?: string;
}

interface ContractSignatureBlock {
  role?: string;
  name?: string;
}

interface SampleContractContent {
  contractType?: string;
  parties?: ContractParty[];
  recitals?: string[];
  clauses?: ContractClause[];
  schedules?: ContractSchedule[];
  signatureBlocks?: ContractSignatureBlock[];
}

function asContract(value: unknown): SampleContractContent | null {
  if (!value || typeof value !== 'object') return null;
  return value as SampleContractContent;
}

export function SampleContractRenderer({ data }: { data: DerivativeDetail }) {
  const content = asContract(data.contentJson);
  if (!content) return <Unavailable />;

  const contractType = content.contractType?.trim() ?? '';
  if (!contractType) return <Unavailable />;

  const parties = (content.parties ?? []).filter(
    (p) => p && (p.role?.trim() || p.name?.trim() || p.address?.trim()),
  );
  const recitals = (content.recitals ?? []).filter((r) => r?.trim());
  const clauses = (content.clauses ?? []).filter(
    (c) => c && (c.heading?.trim() || c.text?.trim() || (c.subclauses ?? []).length > 0),
  );
  const schedules = (content.schedules ?? []).filter(
    (s) => s && (s.heading?.trim() || s.text?.trim()),
  );
  const signatures = (content.signatureBlocks ?? []).filter(
    (s) => s && (s.role?.trim() || s.name?.trim()),
  );

  return (
    <article className="prose prose-sm max-w-none dark:prose-invert">
      <h3 className="not-prose text-center text-lg font-bold uppercase tracking-wide">
        {contractType}
      </h3>

      {parties.length > 0 && (
        <section className="mt-4">
          <h4 className="not-prose text-base font-semibold">Parties</h4>
          <table className="not-prose mt-2 w-full border-collapse text-sm">
            <tbody>
              {parties.map((p, i) => (
                <tr key={`party-${i}`} className="border-b border-border">
                  <td className="py-2 pr-3 font-semibold align-top">{p.role ?? '—'}</td>
                  <td className="py-2 pr-3 align-top">{p.name ?? '—'}</td>
                  <td className="py-2 align-top text-muted-foreground">{p.address ?? ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {data.isGated ? (
        <div className="not-prose mt-6">
          <GatedNotice typeLabel="Sample contract" upgradeTier={data.upgradeTier} />
        </div>
      ) : (
        <>
          {recitals.length > 0 && (
            <section className="mt-6 rounded-md border border-border bg-muted/30 p-4">
              <p className="not-prose mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Recitals
              </p>
              {recitals.map((r, i) => (
                <p key={`rec-${i}`} className="mt-2 whitespace-pre-wrap">
                  <span className="font-semibold">WHEREAS,</span> {r}
                </p>
              ))}
            </section>
          )}

          {clauses.length > 0 && (
            <section className="mt-6">
              <ol className="list-decimal space-y-4 pl-6">
                {clauses.map((c, i) => (
                  <li key={`clause-${i}`}>
                    {c.heading?.trim() && (
                      <h4 className="not-prose text-base font-semibold">{c.heading}</h4>
                    )}
                    {c.text?.trim() && (
                      <p className="mt-2 whitespace-pre-wrap">{c.text}</p>
                    )}
                    {(c.subclauses ?? []).length > 0 && (
                      <ol className="mt-2 list-[lower-alpha] space-y-2 pl-6">
                        {(c.subclauses ?? []).map((sub, j) => (
                          <li key={`sub-${i}-${j}`}>
                            {sub.heading?.trim() && (
                              <span className="font-semibold">{sub.heading}. </span>
                            )}
                            {sub.text?.trim() && <span>{sub.text}</span>}
                          </li>
                        ))}
                      </ol>
                    )}
                  </li>
                ))}
              </ol>
            </section>
          )}

          {schedules.length > 0 && (
            <section className="mt-6 space-y-2">
              {schedules.map((s, i) => (
                <details
                  key={`sched-${i}`}
                  className="not-prose rounded-md border border-border p-3 text-sm"
                >
                  <summary className="cursor-pointer font-semibold">
                    {s.heading ?? `Schedule ${i + 1}`}
                  </summary>
                  {s.text?.trim() && (
                    <p className="mt-2 whitespace-pre-wrap">{s.text}</p>
                  )}
                </details>
              ))}
            </section>
          )}

          {signatures.length > 0 && (
            <section className="not-prose mt-8 grid grid-cols-1 gap-6 sm:grid-cols-2">
              {signatures.map((s, i) => (
                <div key={`sig-${i}`} className="border-t border-border pt-2 text-sm">
                  <p className="font-semibold">{s.name ?? '______________________'}</p>
                  <p className="text-muted-foreground">{s.role ?? ''}</p>
                </div>
              ))}
            </section>
          )}
        </>
      )}
    </article>
  );
}
