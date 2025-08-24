const express = require('express');
const router = express.Router();

router.get('/', (req, res) => {
  res.json({ message: 'Kullanıcılar endpoint' });
});

module.exports = router;