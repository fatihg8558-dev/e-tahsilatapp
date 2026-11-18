import React from 'react';
import { AlertCircle, RefreshCw } from 'lucide-react';

interface ErrorBoundaryState {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = {
      hasError: false,
      errorMessage: '',
    };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      errorMessage: error?.message || 'Beklenmeyen bir arayüz hatası oluştu.',
    };
  }

  componentDidCatch(error: Error, info: React.ErrorInfo): void {
    console.error('UI ErrorBoundary yakaladı:', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[100dvh] bg-[#0a0e13] text-white flex items-center justify-center p-6">
          <div className="max-w-md w-full bg-[#111820] border border-red-500/30 rounded-2xl p-6 text-center space-y-4 shadow-2xl">
            <div className="w-12 h-12 rounded-2xl bg-red-500/15 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto">
              <AlertCircle className="w-6 h-6" />
            </div>
            <div>
              <h2 className="text-base font-extrabold text-white">
                Ekran Yüklenirken Bir Hata Oluştu
              </h2>
              <p className="text-xs text-gray-400 mt-2 leading-relaxed">
                Uygulama beklenmeyen bir durumla karşılaştı. Sayfayı yenileyerek kaldığınız yerden devam edebilirsiniz.
              </p>
              {this.state.errorMessage && (
                <div className="mt-3 p-2.5 rounded-xl bg-black/40 border border-white/10 text-[11px] font-mono text-red-300 break-words">
                  {this.state.errorMessage}
                </div>
              )}
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="w-full py-2.5 px-4 rounded-xl bg-teal-400 hover:bg-teal-300 text-[#0a0e13] font-extrabold text-xs inline-flex items-center justify-center gap-2 transition"
            >
              <RefreshCw className="w-4 h-4" />
              <span>Sayfayı Yenile</span>
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
