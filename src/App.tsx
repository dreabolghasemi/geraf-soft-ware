import React, { Component, type ErrorInfo, type ReactNode } from 'react';
import './firebase-bridge';

interface Props {
  children?: ReactNode;
}

interface State {
  hasError: boolean;
  errorMessage: string;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorMessage: '',
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, errorMessage: error.message || 'خطای غیرمنتظره' };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Uncaught application error:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div
          dir="rtl"
          className="fixed bottom-4 left-4 z-[9999] max-w-md rounded-2xl border border-red-500/40 bg-slate-900 p-4 text-xs text-red-200 shadow-2xl"
        >
          <div className="font-bold text-red-400">خطای ارتباط با پایگاه داده مرکزی</div>
          <p className="mt-1 opacity-90">{this.state.errorMessage}</p>
          <button
            type="button"
            onClick={() => this.setState({ hasError: false, errorMessage: '' })}
            className="mt-2 rounded-lg bg-red-600 px-3 py-1 font-bold text-white"
          >
            بستن
          </button>
        </div>
      );
    }

    return this.props.children ?? null;
  }
}

export default function App() {
  return <ErrorBoundary />;
}
