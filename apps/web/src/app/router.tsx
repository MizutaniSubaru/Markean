import { AppProviders } from "./providers";
import { AppRoute } from "../routes/app";

export function AppRouter() {
  return (
    <AppProviders>
      <AppRoute />
    </AppProviders>
  );
}
