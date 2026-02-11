import React, { createContext, useContext, useState } from "react";

export interface FunctionCallState {
  result: string | null;
  error: string | null;
  isExecuting: boolean;
}

interface FunctionCallContextType {
  callStates: Record<number, FunctionCallState>;
  setCallState: (id: number, state: FunctionCallState) => void;
  getCallState: (id: number) => FunctionCallState;
  hasExecutingCall: () => boolean;
}

const FunctionCallContext = createContext<FunctionCallContextType | undefined>(
  undefined
);

export const FunctionCallProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [callStates, setCallStates] = useState<
    Record<number, FunctionCallState>
  >({});

  const setCallState = (id: number, state: FunctionCallState) => {
    setCallStates((prev) => ({
      ...prev,
      [id]: state,
    }));
  };

  const getCallState = (id: number) => {
    return callStates[id] || { result: null, error: null, isExecuting: false };
  };

  const hasExecutingCall = () =>
    Object.values(callStates).some((state) => state.isExecuting);

  return (
    <FunctionCallContext.Provider
      value={{ callStates, setCallState, getCallState, hasExecutingCall }}
    >
      {children}
    </FunctionCallContext.Provider>
  );
};

export const useFunctionCall = () => {
  const context = useContext(FunctionCallContext);
  if (!context) {
    throw new Error(
      "useFunctionCall must be used within a FunctionCallProvider"
    );
  }
  return context;
};
