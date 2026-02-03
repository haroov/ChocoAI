import ReactDOM from 'react-dom/client';
import './styles/globals.css';
import { ChocoAIWidget } from './components/ChocoAIWidget';
import { WidgetProvider } from './components/ChocoAIWidget/WidgetProvider';
import { WidgetConfig } from './components/ChocoAIWidget';

const getScriptConfig = (): WidgetConfig => {
  const currentScript = document.currentScript || (() => {
    const scripts = document.getElementsByTagName('script');
    return scripts[scripts.length - 1];
  })();

  return {
    rootUrl: currentScript.dataset.rootUrl || 'https://www.chocoinsurance.com',
    position: currentScript.dataset.position as WidgetConfig['position'] || 'bottom-right',
    noWidgetButton: currentScript.dataset.noWidgetButton === 'true'
      || (currentScript.hasAttribute('data-no-widget-button') && !currentScript.dataset.noWidgetButton),
  };
};

const loadStyles = async (config: WidgetConfig, shadowRoot: ShadowRoot) => {
  const cssUrl = `${config.rootUrl}/web-widget/choco-ai-widget.css`;

  // eslint-disable-next-line no-restricted-globals
  const cssText = await fetch(cssUrl).then((response) => response.text());
  const twStylesheet = new CSSStyleSheet();
  twStylesheet.replaceSync(cssText.replace(
    '((-webkit-hyphens:none)) and (not (margin-trim:inline))',
    '(not (margin-trim:inline))',
  ));
  shadowRoot.adoptedStyleSheets = [twStylesheet];
};

const initWidget = async () => {
  const rootContainer = document.createElement('div');
  rootContainer.id = 'choco-ai-widget-root';
  document.body.appendChild(rootContainer);

  const shadow = rootContainer.attachShadow({ mode: 'open' });

  const reactRootDiv = document.createElement('div');
  shadow.appendChild(reactRootDiv);

  const config = getScriptConfig();
  await loadStyles(config, shadow);

  const root = ReactDOM.createRoot(reactRootDiv);
  root.render(
    <WidgetProvider>
      <ChocoAIWidget config={config} />
    </WidgetProvider>,
  );
};

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initWidget);
else initWidget();
