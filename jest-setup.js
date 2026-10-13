// Jest setup provided by Grafana scaffolding
import './.config/jest-setup';

if (typeof URL.canParse !== 'function') {
  URL.canParse = (url, base) => {
    try {
      new URL(url, base);
      return true;
    } catch {
      return false;
    }
  };
}
