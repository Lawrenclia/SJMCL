import React, { createContext, useCallback, useContext, useState } from "react";

interface AgentChatContextType {
  isOpen: boolean;
  open: () => void;
  close: () => void;
  toggle: () => void;
}

const AgentChatContext = createContext<AgentChatContextType | undefined>(
  undefined
);

export const AgentChatContextProvider: React.FC<{
  children: React.ReactNode;
}> = ({ children }) => {
  const [isOpen, setIsOpen] = useState(false);

  const open = useCallback(() => setIsOpen(true), []);
  const close = useCallback(() => setIsOpen(false), []);
  const toggle = useCallback(() => setIsOpen((prev) => !prev), []);

  return (
    <AgentChatContext.Provider value={{ isOpen, open, close, toggle }}>
      {children}
    </AgentChatContext.Provider>
  );
};

export const useAgentChat = (): AgentChatContextType => {
  const context = useContext(AgentChatContext);
  if (!context) {
    throw new Error(
      "useAgentChat must be used within AgentChatContextProvider"
    );
  }
  return context;
};
