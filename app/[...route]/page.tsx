import Platform from "../platform";

export default async function RoutedPage({ params }: { params: Promise<{ route: string[] }> }) {
  const { route } = await params;
  return <Platform initialPath={`/${route.join("/")}`} />;
}
