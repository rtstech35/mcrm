const jwt = require('jsonwebtoken');
const pool = require('../config/database');
const JWT_SECRET = process.env.JWT_SECRET || "fallback_secret_key_change_in_production";

const authenticateToken = async (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ message: 'Token gerekli' });
  }

  try {
    const decoded = jwt.verify(token, JWT_SECRET);
    // Kullanıcı bilgilerini her istekte DB'den çekmek, rol/yetki değişikliklerinin anında yansımasını sağlar.
    const result = await pool.query(
      'SELECT u.id, u.username, u.full_name, u.is_active, r.name as role_name, r.permissions, d.name as department_name FROM users u LEFT JOIN roles r ON u.role_id = r.id LEFT JOIN departments d ON u.department_id = d.id WHERE u.id = $1 AND u.is_active = true',
      [decoded.userId]
    );

    if (result.rows.length === 0) {
      return res.status(403).json({ message: 'Geçersiz veya pasif kullanıcı' });
    }

    // req.user objesini oluşturalım.
    const user = result.rows[0];
    req.user = {
        userId: user.id,
        username: user.username,
        permissions: user.permissions || {},
        role: user.role_name
    };
    next();
  } catch (error) {
    return res.status(403).json({ message: 'Geçersiz token' });
  }
};

const checkPermission = (requiredPermission) => {
  return (req, res, next) => {
    const permissions = req.user.permissions || {};

    if (permissions.all === true) {
      return next();
    }

    const [module, action] = requiredPermission.split('.');
    const userModulePermissions = permissions[module];

    if (userModulePermissions && (userModulePermissions === true || (Array.isArray(userModulePermissions) && userModulePermissions.includes(action)))) {
      return next();
    }

    return res.status(403).json({ success: false, error: 'Bu işlem için yetkiniz yok.' });
  };
};

module.exports = { authenticateToken, checkPermission };