# Neurabody Backend - Development Guidelines

This document provides coding standards and best practices for the Neurabody backend API service.

## Node.js/Express Architecture

### Project Structure

Keep routes, controllers, services, and models separated.

✅ GOOD:
```
backend/
├── src/
│   ├── routes/
│   │   ├── characters.ts       # Route definitions
│   │   ├── exercises.ts
│   │   └── auth.ts
│   ├── controllers/
│   │   ├── character-controller.ts    # Request/response handling
│   │   └── exercise-controller.ts
│   ├── services/
│   │   ├── character-service.ts       # Business logic
│   │   └── storage-service.ts
│   ├── models/
│   │   ├── character.ts               # Data models/types
│   │   └── exercise.ts
│   ├── middleware/
│   │   ├── error-handler.ts
│   │   ├── validation.ts
│   │   └── auth.ts
│   ├── utils/
│   │   ├── logger.ts
│   │   └── config.ts
│   └── app.ts                         # Express app setup
├── models/                            # 3D assets (FBX files)
├── .env
└── package.json
```

### Layered Architecture

Separate concerns: Routes → Controllers → Services → Data Access

✅ GOOD:
```typescript
// routes/characters.ts
import { Router } from 'express';
import { CharacterController } from '../controllers/character-controller';

export const charactersRouter = Router();
const controller = new CharacterController();

charactersRouter.get('/', controller.listCharacters);
charactersRouter.get('/:id', controller.getCharacter);

// controllers/character-controller.ts
export class CharacterController {
  constructor(private characterService: CharacterService) {}
  
  listCharacters = async (req: Request, res: Response, next: NextFunction) => {
    try {
      const characters = await this.characterService.getAll();
      res.json({ characters });
    } catch (error) {
      next(error);
    }
  };
}

// services/character-service.ts
export class CharacterService {
  async getAll(): Promise<Character[]> {
    // Business logic here
    return this.scanCharacterDirectory();
  }
}
```

❌ BAD:
```typescript
// Everything mixed in route file
app.get('/api/characters', async (req, res) => {
  const dir = fs.readdirSync('./models');
  const characters = dir.filter(f => f.startsWith('ch')).map(f => {
    // 50+ lines of logic in route handler
  });
  res.json({ characters });
});
```

## API Design Conventions

### RESTful Endpoints

Follow REST conventions for predictable APIs.

✅ GOOD:
```typescript
GET    /api/characters           # List all
GET    /api/characters/:id       # Get one
POST   /api/characters           # Create
PUT    /api/characters/:id       # Update
PATCH  /api/characters/:id       # Partial update
DELETE /api/characters/:id       # Delete

GET    /api/characters/:id/animations   # Sub-resources
```

### Request Validation

Validate all inputs using middleware.

✅ GOOD:
```typescript
import { body, param, validationResult } from 'express-validator';

export const validateCharacter = [
  body('name').isString().trim().notEmpty(),
  body('modelPath').isString().notEmpty(),
  (req: Request, res: Response, next: NextFunction) => {
    const errors = validationResult(req);
    if (!errors.isEmpty()) {
      return res.status(400).json({ 
        error: 'Validation failed',
        details: errors.array() 
      });
    }
    next();
  }
];

// Usage
router.post('/characters', validateCharacter, controller.createCharacter);
```

❌ BAD:
```typescript
app.post('/characters', (req, res) => {
  const { name, modelPath } = req.body;
  // No validation - vulnerable to bad input
  const character = createCharacter(name, modelPath);
  res.json(character);
});
```

### Response Format

Use consistent response structures.

✅ GOOD:
```typescript
// Success responses
res.json({
  characters: [...],
  pagination: { page: 1, total: 50 }
});

// Error responses
res.status(400).json({
  error: 'Invalid character ID',
  code: 'INVALID_ID',
  details: { id: 'ch99' }
});
```

### HTTP Status Codes

Use appropriate status codes:
- `200 OK` - Successful GET, PUT, PATCH
- `201 Created` - Successful POST
- `204 No Content` - Successful DELETE
- `400 Bad Request` - Validation errors
- `401 Unauthorized` - Missing/invalid auth
- `403 Forbidden` - Valid auth, insufficient permissions
- `404 Not Found` - Resource doesn't exist
- `500 Internal Server Error` - Server errors

## Error Handling & Logging

### Centralized Error Handler

Use Express error handling middleware.

✅ GOOD:
```typescript
// middleware/error-handler.ts
export class AppError extends Error {
  constructor(
    public statusCode: number,
    public message: string,
    public code?: string,
    public details?: any
  ) {
    super(message);
    this.name = 'AppError';
  }
}

export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  next: NextFunction
) => {
  if (err instanceof AppError) {
    return res.status(err.statusCode).json({
      error: err.message,
      code: err.code,
      details: err.details
    });
  }
  
  // Log unexpected errors
  logger.error('Unexpected error', {
    error: err,
    url: req.url,
    method: req.method
  });
  
  res.status(500).json({
    error: 'Internal server error',
    code: 'INTERNAL_ERROR'
  });
};

// app.ts
app.use(errorHandler);
```

### Structured Logging

Use structured logging with context.

✅ GOOD:
```typescript
import winston from 'winston';

export const logger = winston.createLogger({
  level: process.env.LOG_LEVEL || 'info',
  format: winston.format.combine(
    winston.format.timestamp(),
    winston.format.json()
  ),
  transports: [
    new winston.transports.File({ filename: 'error.log', level: 'error' }),
    new winston.transports.File({ filename: 'combined.log' })
  ]
});

// Usage
logger.info('Character loaded', { 
  characterId: 'ch03', 
  duration: 45 
});

logger.error('Failed to load model', { 
  characterId: 'ch03', 
  error: err.message,
  stack: err.stack 
});
```

❌ BAD:
```typescript
console.log('Character loaded');  // No context
console.log(error);               // Unstructured
```

### Async/Await Error Handling

Always catch errors in async route handlers.

✅ GOOD:
```typescript
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};

// Usage
router.get('/characters', asyncHandler(async (req, res) => {
  const characters = await characterService.getAll();
  res.json({ characters });
  // Errors automatically caught and passed to error handler
}));
```

❌ BAD:
```typescript
router.get('/characters', async (req, res) => {
  const characters = await characterService.getAll();
  // If this throws, it won't be caught - crashes server
  res.json({ characters });
});
```

## CORS & Security

### CORS Configuration

Configure CORS properly for TV app origin.

✅ GOOD:
```typescript
import cors from 'cors';

const corsOptions: cors.CorsOptions = {
  origin: (origin, callback) => {
    const allowedOrigins = [
      process.env.TV_APP_ORIGIN,
      'http://localhost:3000',  // Dev
      'tizen://app'             // Tizen app
    ].filter(Boolean);
    
    if (!origin || allowedOrigins.includes(origin)) {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  },
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization']
};

app.use(cors(corsOptions));
```

### Security Middleware

Use helmet and other security middleware.

```typescript
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';

// Security headers
app.use(helmet());

// Rate limiting
const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per windowMs
  message: 'Too many requests from this IP'
});

app.use('/api/', limiter);

// Body size limits
app.use(express.json({ limit: '10mb' }));
```

### Input Sanitization

Sanitize user inputs to prevent injection attacks.

```typescript
import { body, sanitize } from 'express-validator';

export const sanitizeInput = [
  body('name').trim().escape(),
  body('description').trim().escape(),
];
```

## File Organization

### Character/Model Management

Organize 3D assets systematically.

```
models/
├── ch03/
│   ├── Ch03_nonPBR.fbx         # Base model
│   ├── thumbnail.jpg           # Preview image
│   ├── idle.fbx                # Animations
│   ├── walking.fbx
│   ├── running.fbx
│   └── metadata.json           # Optional metadata
├── ch19/
└── ch24/
```

### Model Scanning Service

```typescript
export class CharacterService {
  private readonly modelsDir = path.join(__dirname, '../../models');
  
  async getAll(): Promise<Character[]> {
    const dirs = await fs.promises.readdir(this.modelsDir);
    const characterDirs = dirs.filter(d => d.startsWith('ch'));
    
    const characters = await Promise.all(
      characterDirs.map(dir => this.loadCharacter(dir))
    );
    
    return characters.filter(Boolean);
  }
  
  private async loadCharacter(dirName: string): Promise<Character | null> {
    try {
      const dirPath = path.join(this.modelsDir, dirName);
      const files = await fs.promises.readdir(dirPath);
      
      const baseModel = files.find(f => f.includes('nonPBR.fbx') || f === 'base.fbx');
      if (!baseModel) {
        logger.warn('No base model found', { directory: dirName });
        return null;
      }
      
      const animations = files
        .filter(f => f.endsWith('.fbx') && f !== baseModel)
        .map(f => ({
          name: path.basename(f, '.fbx'),
          url: `/models/${dirName}/${f}`
        }));
      
      return {
        id: dirName,
        name: this.formatName(dirName),
        modelUrl: `/models/${dirName}/${baseModel}`,
        thumbnail: `/models/${dirName}/thumbnail.jpg`,
        animations
      };
    } catch (error) {
      logger.error('Failed to load character', { directory: dirName, error });
      return null;
    }
  }
  
  private formatName(dirName: string): string {
    // "ch03" -> "Character 03"
    const num = dirName.replace('ch', '');
    return `Character ${num.padStart(2, '0')}`;
  }
}
```

## Environment Configuration

### Environment Variables

Use .env for configuration, never commit secrets.

✅ GOOD:
```typescript
// utils/config.ts
import dotenv from 'dotenv';

dotenv.config();

export const config = {
  port: parseInt(process.env.PORT || '3001', 10),
  nodeEnv: process.env.NODE_ENV || 'development',
  corsOrigin: process.env.CORS_ORIGIN || '*',
  
  // Database (when added)
  database: {
    host: process.env.DB_HOST || 'localhost',
    port: parseInt(process.env.DB_PORT || '5432', 10),
    name: process.env.DB_NAME || 'neurabody',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD
  },
  
  // AWS (if needed)
  aws: {
    region: process.env.AWS_REGION || 'ap-northeast-2',
    accessKeyId: process.env.AWS_ACCESS_KEY_ID,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY
  }
};

// Validate required env vars
const required = ['PORT'];
for (const key of required) {
  if (!process.env[key]) {
    throw new Error(`Missing required environment variable: ${key}`);
  }
}
```

### .env.example

Always provide .env.example for developers.

```bash
# Server
PORT=3001
NODE_ENV=development

# CORS
CORS_ORIGIN=http://localhost:3000

# Database (example for future use)
DB_HOST=localhost
DB_PORT=5432
DB_NAME=neurabody
DB_USER=postgres
DB_PASSWORD=

# AWS
AWS_REGION=ap-northeast-2
AWS_ACCESS_KEY_ID=
AWS_SECRET_ACCESS_KEY=
```

## Testing & Validation

### Unit Tests

Test services and business logic.

```typescript
import { CharacterService } from '../services/character-service';

describe('CharacterService', () => {
  let service: CharacterService;
  
  beforeEach(() => {
    service = new CharacterService();
  });
  
  it('should load all characters', async () => {
    const characters = await service.getAll();
    
    expect(characters).toBeInstanceOf(Array);
    expect(characters.length).toBeGreaterThan(0);
    expect(characters[0]).toHaveProperty('id');
    expect(characters[0]).toHaveProperty('modelUrl');
  });
  
  it('should format character names correctly', () => {
    const name = service['formatName']('ch03');
    expect(name).toBe('Character 03');
  });
  
  it('should handle missing base model gracefully', async () => {
    // Test with directory that has no base model
    const character = await service['loadCharacter']('invalid');
    expect(character).toBeNull();
  });
});
```

### Integration Tests

Test API endpoints end-to-end.

```typescript
import request from 'supertest';
import { app } from '../app';

describe('GET /api/characters', () => {
  it('should return list of characters', async () => {
    const response = await request(app)
      .get('/api/characters')
      .expect(200)
      .expect('Content-Type', /json/);
    
    expect(response.body).toHaveProperty('characters');
    expect(response.body.characters).toBeInstanceOf(Array);
  });
  
  it('should return 404 for non-existent character', async () => {
    await request(app)
      .get('/api/characters/ch999')
      .expect(404);
  });
});

describe('GET /api/health', () => {
  it('should return healthy status', async () => {
    const response = await request(app)
      .get('/health')
      .expect(200);
    
    expect(response.body).toEqual({ status: 'healthy' });
  });
});
```

## API Versioning

### URL-based Versioning

Prepare for API evolution with versioning.

✅ GOOD:
```typescript
// routes/index.ts
import { Router } from 'express';
import { charactersRouter as charactersV1 } from './v1/characters';
import { charactersRouter as charactersV2 } from './v2/characters';

export const apiRouter = Router();

// Version 1 (current)
apiRouter.use('/v1/characters', charactersV1);

// Version 2 (future)
// apiRouter.use('/v2/characters', charactersV2);

// Default to latest version
apiRouter.use('/characters', charactersV1);
```

## Database Integration (Future)

When adding a database, follow this pattern:

```typescript
// services/database.ts
import { Pool } from 'pg';
import { config } from '../utils/config';

export const pool = new Pool({
  host: config.database.host,
  port: config.database.port,
  database: config.database.name,
  user: config.database.user,
  password: config.database.password
});

// repositories/character-repository.ts
export class CharacterRepository {
  async findAll(): Promise<Character[]> {
    const result = await pool.query('SELECT * FROM characters');
    return result.rows;
  }
  
  async findById(id: string): Promise<Character | null> {
    const result = await pool.query(
      'SELECT * FROM characters WHERE id = $1',
      [id]
    );
    return result.rows[0] || null;
  }
}
```

## Performance Best Practices

### Caching

Cache static data that doesn't change often.

```typescript
import NodeCache from 'node-cache';

const cache = new NodeCache({ stdTTL: 3600 }); // 1 hour

export class CharacterService {
  async getAll(): Promise<Character[]> {
    const cached = cache.get<Character[]>('characters');
    if (cached) {
      return cached;
    }
    
    const characters = await this.loadCharacters();
    cache.set('characters', characters);
    return characters;
  }
}
```

### Compression

Enable response compression.

```typescript
import compression from 'compression';

app.use(compression());
```

## Summary

**Key Principles:**
1. Separate routes, controllers, services, models
2. Validate all inputs
3. Use structured logging with context
4. Handle errors properly (async/await with try-catch)
5. Configure CORS and security middleware
6. Use environment variables for config
7. Write tests for business logic and APIs
8. Plan for API versioning
9. Cache static data
10. Document all endpoints

**Common Antipatterns to Avoid:**
1. Mixing business logic in route handlers
2. No input validation
3. Silent error handling (empty catch blocks)
4. Hardcoded configuration values
5. Unstructured logging (console.log)
6. No error status codes (always 200)
7. Overly permissive CORS (origin: *)
8. No request rate limiting
9. Missing async error handling
10. No tests
