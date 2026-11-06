import { SCREENS } from './screenRegistry';
import { StyleguideToolbar } from './StyleguideToolbar';
import styles from './Styleguide.module.css';

export interface ScreenPreviewProps {
  screenId: string;
  variantId?: string | undefined;
}

/** Renders one screen fixture full-page under a slim dev toolbar (variant + theme switcher). */
export function ScreenPreview({ screenId, variantId }: ScreenPreviewProps) {
  const screen = SCREENS.find((s) => s.id === screenId);
  if (!screen) {
    return (
      <main className={styles.page}>
        <h1>Unknown screen: {screenId}</h1>
        <a href="#/styleguide/screens">Back to screens</a>
      </main>
    );
  }
  const variant = screen.variants.find((v) => v.id === variantId) ?? screen.variants[0];
  return (
    <>
      <StyleguideToolbar>
        <a href="#/styleguide/screens" className={styles.toolbarLink}>
          All screens
        </a>
        <span className={styles.toolbarTitle}>{screen.label}</span>
        <nav aria-label="Variants" className={styles.variants}>
          {screen.variants.map((v) => (
            <a
              key={v.id}
              href={`#/preview/${screen.id}/${v.id}`}
              aria-current={v.id === variant?.id ? 'page' : undefined}
              className={styles.variantLink}
            >
              {v.label}
            </a>
          ))}
        </nav>
      </StyleguideToolbar>
      <div key={`${screen.id}/${variant?.id ?? ''}`}>{variant?.render()}</div>
    </>
  );
}
