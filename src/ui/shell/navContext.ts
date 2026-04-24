import { createContext, useContext } from "react";

interface NavigationContextType {
  openMenu: () => void;
}

export const NavigationContext = createContext<NavigationContextType>({
  openMenu: () => {},
});

export function useNavigation() {
  return useContext(NavigationContext);
}
