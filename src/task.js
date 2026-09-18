// routes/tasks.js
const express = require('express');
const router = express.Router();
const db = require('./db');

// GET /api/tasks
router.get('/', (req, res) => {
  const tasks = db.prepare('SELECT * FROM tasks').all();
  res.json({ success: true, count: tasks.length, data: tasks });
});

// POST /api/tasks
router.post('/', (req, res) => {
  const { title, completed } = req.body;
  if (!title) {
    return res.status(400).json({ success: false, error: 'Title is required' });
  }

  const isCompleted = completed ? 1 : 0;
  const statement = db.prepare('INSERT INTO tasks (title, completed) VALUES (?, ?)');
  const result = statement.run(title, isCompleted);
  const newTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(result.lastInsertRowid);

  res.status(201).json({ success: true, data: newTask });
});

// PUT /api/tasks/:id
router.put('/:id', (req, res) => {
  const taskId = parseInt(req.params.id);
  const { title, completed } = req.body;

  const existingTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  if (!existingTask) {
    return res.status(404).json({ success: false, error: 'Task not found' });
  }

  const updatedTitle = title !== undefined ? title : existingTask.title;
  const updatedCompleted = completed !== undefined ? (completed ? 1 : 0) : existingTask.completed;

  db.prepare('UPDATE tasks SET title = ?, completed = ? WHERE id = ?')
    .run(updatedTitle, updatedCompleted, taskId);

  const updatedTask = db.prepare('SELECT * FROM tasks WHERE id = ?').get(taskId);
  res.json({ success: true, data: updatedTask });
});

// DELETE /api/tasks/:id
router.delete('/:id', (req, res) => {
  const taskId = parseInt(req.params.id);
  const result = db.prepare('DELETE FROM tasks WHERE id = ?').run(taskId);

  if (result.changes === 0) {
    return res.status(404).json({ success: false, error: 'Task not found' });
  }

  res.json({ success: true, message: `Task ${taskId} deleted successfully` });
});

module.exports = router;