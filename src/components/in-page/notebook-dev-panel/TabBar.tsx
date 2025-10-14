import { cn } from "@/lib/utils";

type TabDefinition = {
  id: string;
  label: string;
};

const TABS: TabDefinition[] = [
  { id: "overview", label: "Overview" },
  { id: "structure", label: "Structure" },
  { id: "awareness", label: "Awareness" },
  { id: "undo", label: "Undo" },
  { id: "traffic", label: "Traffic" },
  { id: "validation", label: "Validation" },
];

type TabBarProps = {
  activeTab: string;
  onChange: (tab: string) => void;
};

export function TabBar({ activeTab, onChange }: TabBarProps) {
  return (
    <div className="flex border-b border-border/70 bg-muted/30 text-xs">
      {TABS.map((tab) => (
        <button
          key={tab.id}
          onClick={() => onChange(tab.id)}
          className={cn(
            "px-4 py-2 transition-colors",
            activeTab === tab.id
              ? "border-b-2 border-primary text-foreground"
              : "text-muted-foreground hover:text-foreground"
          )}
        >
          {tab.label}
        </button>
      ))}
    </div>
  );
}
