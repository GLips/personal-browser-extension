import { render } from "preact";
import { useEffect, useState } from "preact/hooks";
import {
  type FeatureInfo,
  featureCatalog,
  featureEnabledItem,
} from "../../platform/feature-settings";
import "./style.css";

function FeatureToggle({ feature }: { feature: FeatureInfo }) {
  const item = featureEnabledItem(feature.id);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    item.getValue().then(setEnabled);
    return item.watch(setEnabled);
  }, [item]);

  return (
    <label class="feature">
      <input
        type="checkbox"
        checked={enabled ?? false}
        disabled={enabled === null}
        onChange={(e) => item.setValue(e.currentTarget.checked)}
      />
      <span>
        <strong>{feature.title}</strong>
        <small>{feature.description}</small>
      </span>
    </label>
  );
}

function OptionsPage() {
  return (
    <main>
      <h1>Features</h1>
      {featureCatalog.map((feature) => (
        <FeatureToggle key={feature.id} feature={feature} />
      ))}
    </main>
  );
}

const root = document.getElementById("app");
if (!root) throw new Error("options page is missing #app");
render(<OptionsPage />, root);
