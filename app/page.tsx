import Platform from "./platform";
import { loadPlatformData } from "../lib/hearthland/platform-repository";

export default async function Home() {
  const data = await loadPlatformData();
  return <Platform data={data} initialPath="/" />;
}
