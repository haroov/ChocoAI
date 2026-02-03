import React from 'react';
import { createTranslator } from 'use-intl';
import oopsPicture from '../assets/oops.svg';
import { en } from '../helpers/localization';

interface IErrorBoundaryState {
  hasError: boolean;
}

export default class ErrorBoundary extends React.Component<React.PropsWithChildren<unknown>, IErrorBoundaryState> {
  private translator = createTranslator({ messages: en, locale: 'en' });

  constructor(props: unknown) {
    super(props as never);

    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    // Update state so the next render will show the fallback UI.
    return { hasError: true };
  }

  render() {
    const { hasError } = this.state;
    const { children } = this.props;

    if (hasError) {
      return (
        <div className="w-screen h-screen flex justify-center items-center">
          <div className="flex justify-center items-center gap-5 max-w-screen-lg px-6 w-10/12">
            <div>
              <h1 className="font-title text-title text-5xl mb-2">
                {this.translator('ApplicationError.applicationError')}
              </h1>

              <p className="text-label whitespace-pre-wrap">
                {this.translator('ApplicationError.unknownApplicationErrorMsg')}
              </p>

              <a
                href="/"
                className="inline-flex items-center rounded-md border border-transparent bg-primary
                           mt-4 px-4 py-2 text-sm font-medium text-white shadow-sm hover:opacity-70
                           focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2"
              >
                {this.translator('ApplicationError.goToHomeScreen')}
              </a>
            </div>
            <img className="hidden md:block w-96" src={oopsPicture} alt="" />
          </div>
        </div>
      );
    }

    return children;
  }
}
