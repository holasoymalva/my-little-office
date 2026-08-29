import { OfficeDashboard } from './components/office-dashboard';
import { officeConfig } from './office.config';

export default function Home() {
  return <OfficeDashboard config={officeConfig} />;
}
