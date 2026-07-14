export interface SortOption {
  value: string;
  label: string;
}

export function SortControl({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: SortOption[];
}) {
  return (
    <div className="sort-bar">
      <label htmlFor="sortBy">Sortuj:</label>
      <select id="sortBy" value={value} onChange={(e) => onChange(e.target.value)}>
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </div>
  );
}
