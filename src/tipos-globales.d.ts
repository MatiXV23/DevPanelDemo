declare global {
  interface Window {
    __demoLista?: Promise<void>;
    __demoListo?: () => void;
  }
}
export {};
