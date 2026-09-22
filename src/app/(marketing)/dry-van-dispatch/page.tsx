import { EquipmentLanding } from "@/components/marketing/equipment-landing";
import { equipmentPage } from "@/content/marketing";
import { pageMetadata } from "@/lib/seo";

const page = equipmentPage("dry_van");

export const metadata = pageMetadata({ title: page.metaTitle, description: page.metaDescription, path: page.path });

export default function Page() {
  return <EquipmentLanding page={page} />;
}
