export {};

declare global {
  interface AndroidBridgeInterface {
    sendWhatsApp?: (phone: string, message: string) => boolean;
    openExternal?: (url: string) => boolean;
    sharePdfFile?: (
      base64Data: string,
      fileName: string,
      targetApp: string,
      recipient: string,
      subject: string,
      caption: string
    ) => boolean;
  }

  interface Window {
    AndroidBridge?: AndroidBridgeInterface;
  }
}
