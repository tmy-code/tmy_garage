import type { ConsumableBuyState } from '../../shared/purchases.ts';
import { markAdded, type MergedNeed, type ProductGroup } from '../../shared/session-consumables.ts';
import type { Product, Snapshot } from '../../shared/types.ts';
import { BuyChips, Field } from '../components.tsx';
import { formatMoney, localizeNumber, taskName } from '../format.ts';
import { useT } from '../i18n.ts';

/** The "other product" choice of the picker: a part typed by hand, still tied to the required type. */
export const OTHER_PRODUCT = '__other';

const productLabel = (p: Product) => p.name || [p.brand, p.reference].filter(Boolean).join(' ');

/**
 * What the ticked Tasks need, from the Notion reference data in the offline copy: one block per required consumable type
 * (however many Tasks ask for it) with the vehicle's own sheet, the torque values of those Tasks' components, and a picker
 * for the product. A block is open until a line was added for its type, then folds away so the rest of the form stays close.
 */
export function SessionConsumables({
  needs,
  snapshot,
  lines,
  buy,
  onAdd,
}: {
  needs: MergedNeed[];
  snapshot: Snapshot;
  /** The products of the form's lines for a type (null for a line typed by hand). */
  lines: (typeId: string) => (string | null)[];
  /** Whether each required type was bought since its Task was last done, by consumable type id (from Notion's Achats). */
  buy: Map<string, ConsumableBuyState>;
  /** A product was picked (its id), or the owner will type the item (OTHER_PRODUCT). */
  onAdd: (need: MergedNeed, productId: string) => void;
}) {
  const t = useT();
  const tasks = new Map(snapshot.tasks.map((task) => [task.id, task]));
  const toFill = <span className="muted">{t.workshop.specToFill}</span>;
  return (
    <>
      {needs.map((need) => {
        const inForm = lines(need.type.id);
        const options = markAdded(need.choices, inForm);
        const groups: [ProductGroup, string][] = [
          ['chosen', t.notion.productChosen],
          ['compatible', t.notion.productCompatible],
          ['other', t.notion.productOthers],
        ];
        return (
          <details key={need.type.id} className="card consumables" open={inForm.length === 0}>
            <summary>
              <h2 className="need-title">
                {t.notion.consumablesTitle} · {need.type.name}
              </h2>
            </summary>
            <BuyChips states={buy.has(need.type.id) ? [buy.get(need.type.id)!] : []} shop />
            <p className="muted">{t.notion.servesTasks(need.taskIds.map((id) => (tasks.get(id) ? taskName(tasks.get(id)!, t) : '')).filter(Boolean).join(', '))}</p>
            {need.torque.length > 0 ? (
              <ul className="list list-plain">
                {need.torque.map(({ component, spec }) => (
                  <li key={spec.id} className="need-torque">
                    <strong>{component.name}</strong>
                    <span>{t.notion.torqueLine([localizeNumber(spec.value, t), spec.unit].filter(Boolean).join(' '))}</span>
                    {spec.status === 'to_confirm' ? <span className="chip chip-dueSoon">{t.notion.toConfirm}</span> : null}
                  </li>
                ))}
              </ul>
            ) : null}
            {need.rows.length === 0 ? <p className="muted">{t.notion.noSheet}</p> : null}
            {need.rows.map((row) => (
              <div key={row.id} className="need-sheet">
                {need.rows.length > 1 ? <span className="muted">{row.name}</span> : null}
                <dl className="need-facts">
                  <dt>{t.notion.specLabel}</dt>
                  <dd>{row.specification ?? toFill}</dd>
                  <dt>{t.workshop.specOem}</dt>
                  <dd>{row.oemRef ?? toFill}</dd>
                  <dt>{t.notion.capacityLabel}</dt>
                  <dd>{row.capacity ? localizeNumber(row.capacity, t) : toFill}</dd>
                  <dt>{t.workshop.quantity}</dt>
                  <dd>{row.quantity !== null ? localizeNumber(row.quantity, t) : toFill}</dd>
                </dl>
                {row.status ? <span className={`chip ${row.status === 'confirmed' ? 'chip-ok' : 'chip-dueSoon'}`}>{row.status === 'confirmed' ? t.notion.confirmed : t.notion.toConfirm}</span> : null}
              </div>
            ))}
            {options.length === 0 ? <p className="muted">{t.notion.noProduct}</p> : null}
            <Field label={t.notion.pickProduct}>
              <select value="" onChange={(e) => e.target.value && onAdd(need, e.target.value)}>
                <option value="">{t.notion.choose}</option>
                {groups.map(([group, label]) => {
                  const inGroup = options.filter((o) => o.group === group);
                  return inGroup.length > 0 ? (
                    <optgroup key={group} label={label}>
                      {inGroup.map(({ product, added }) => (
                        <option key={product.id} value={product.id}>
                          {productLabel(product)}
                          {product.price !== null ? ` · ${formatMoney(product.price, t)}` : ''}
                          {added ? ` ${t.notion.alreadyAdded}` : ''}
                        </option>
                      ))}
                    </optgroup>
                  ) : null;
                })}
                <option value={OTHER_PRODUCT}>{options.length === 0 ? t.notion.typeItem : t.notion.otherProduct}</option>
              </select>
            </Field>
            {inForm.length > 0 ? (
              <p className="muted" role="status">
                {t.notion.addedBelow(inForm.length)}
              </p>
            ) : null}
          </details>
        );
      })}
    </>
  );
}
