import React, { createContext, useContext, useState } from "react";

export interface FunctionCallState {
  result: string | null;
  error: string | null;
  isExecuting: boolean;
}

interface FunctionCallContextType {
  // Key: messageId-functionIndex
  callStates: Record<string, FunctionCallState>;
  setCallState: (id: number, state: FunctionCallState) => void;
  getCallState: (id: number) => FunctionCallState;
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

  return (
    <FunctionCallContext.Provider
      value={{ callStates, setCallState, getCallState }}
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
