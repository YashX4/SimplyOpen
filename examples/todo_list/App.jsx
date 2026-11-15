import React, { useState } from "react";
import { Plus, Trash2 } from "lucide-react";

export default function TodoList() {
  const [items, setItems] = useState([]);
  const [text, setText] = useState("");
  const add = () => { if (text.trim()) { setItems([...items, text.trim()]); setText(""); } };
  return (
    <div className="max-w-md mx-auto p-6">
      <h1 className="text-2xl font-bold mb-4">To-do list</h1>
      <div className="flex gap-2">
        <input className="border rounded px-2 py-1 flex-1" value={text} onChange={(e) => setText(e.target.value)} />
        <button className="bg-blue-600 text-white rounded px-3" onClick={add}><Plus size={16} /></button>
      </div>
      <ul className="mt-4 space-y-2">
        {items.map((item, i) => (
          <li key={i} className="flex justify-between border rounded px-2 py-1">
            {item}
            <button onClick={() => setItems(items.filter((_, j) => j !== i))}><Trash2 size={16} /></button>
          </li>
        ))}
      </ul>
    </div>
  );
}
