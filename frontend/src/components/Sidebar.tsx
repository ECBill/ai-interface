import { useState, useMemo } from "react";
import { useConversationStore } from "../stores/conversationStore";
import type { ConversationSummary } from "../types";

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onNewChat: () => void;
}

function groupByTime(
  conversations: ConversationSummary[],
): { label: string; items: ConversationSummary[] }[] {
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const yesterday = new Date(today.getTime() - 86400000);
  const sevenDaysAgo = new Date(today.getTime() - 7 * 86400000);

  const groups: Record<string, ConversationSummary[]> = {
    今天: [],
    昨天: [],
    "近7天": [],
    更早: [],
  };

  for (const conv of conversations) {
    const d = new Date(conv.lastMessageAt || conv.updatedAt);
    if (d >= today) groups["今天"].push(conv);
    else if (d >= yesterday) groups["昨天"].push(conv);
    else if (d >= sevenDaysAgo) groups["近7天"].push(conv);
    else groups["更早"].push(conv);
  }

  return Object.entries(groups)
    .filter(([, items]) => items.length > 0)
    .map(([label, items]) => ({ label, items }));
}

export function Sidebar({ collapsed, mobileOpen, onNewChat }: SidebarProps) {
  const {
    conversations,
    activeConversation,
    searchQuery,
    setSearchQuery,
    selectConversation,
    renameConversation,
    deleteConversation,
  } = useConversationStore();

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");

  const filtered = useMemo(() => {
    if (!searchQuery.trim()) return conversations;
    const q = searchQuery.toLowerCase();
    return conversations.filter(
      (c) =>
        c.title.toLowerCase().includes(q) ||
        c.lastMessagePreview?.toLowerCase().includes(q),
    );
  }, [conversations, searchQuery]);

  const groups = useMemo(() => groupByTime(filtered), [filtered]);

  const handleRename = async (id: string) => {
    if (renameValue.trim()) {
      await renameConversation(id, renameValue.trim());
    }
    setRenamingId(null);
  };

  const handleDelete = async (id: string) => {
    if (confirm("确定删除这个对话？此操作不可撤销。")) {
      await deleteConversation(id);
    }
  };

  return (
    <aside
      className={`sidebar ${collapsed ? "collapsed" : ""} ${mobileOpen ? "mobile-open" : ""}`}
    >
      <div className="sidebar-header">
        <button className="new-chat-btn" onClick={onNewChat}>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
            <line x1="12" y1="5" x2="12" y2="19" />
            <line x1="5" y1="12" x2="19" y2="12" />
          </svg>
          新对话
        </button>
        <input
          className="sidebar-search"
          type="text"
          placeholder="搜索对话..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
        />
      </div>
      <div className="conv-list">
        {groups.length === 0 ? (
          <div className="conv-empty">
            {searchQuery ? "未找到匹配的对话" : "还没有对话，点击上方开始"}
          </div>
        ) : (
          groups.map((group) => (
            <div key={group.label}>
              <div className="conv-group-label">{group.label}</div>
              {group.items.map((conv) => (
                <div
                  key={conv.id}
                  className={`conv-item ${activeConversation?.id === conv.id ? "active" : ""}`}
                  onClick={() => selectConversation(conv.id)}
                >
                  {renamingId === conv.id ? (
                    <div
                      className="rename-dialog"
                      onClick={(e) => e.stopPropagation()}
                    >
                      <input
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") handleRename(conv.id);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        autoFocus
                      />
                      <button onClick={() => handleRename(conv.id)}>✓</button>
                    </div>
                  ) : (
                    <>
                      <div className="conv-item-title">{conv.title}</div>
                      <div className="conv-item-preview">
                        {conv.lastMessagePreview || "暂无消息"}
                      </div>
                      <div className="conv-item-actions">
                        <button
                          className="conv-action-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            setRenamingId(conv.id);
                            setRenameValue(conv.title);
                          }}
                          title="重命名"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
                            <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
                          </svg>
                        </button>
                        <button
                          className="conv-action-btn"
                          onClick={(e) => {
                            e.stopPropagation();
                            handleDelete(conv.id);
                          }}
                          title="删除"
                        >
                          <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                            <polyline points="3 6 5 6 21 6" />
                            <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
                          </svg>
                        </button>
                      </div>
                    </>
                  )}
                </div>
              ))}
            </div>
          ))
        )}
      </div>
    </aside>
  );
}
