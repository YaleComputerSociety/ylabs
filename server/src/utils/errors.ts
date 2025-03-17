export class NotFoundError extends Error {
    status: number;

    constructor(message: string) {
        super(message);
        this.status = 404;
        Object.setPrototypeOf(this, NotFoundError.prototype);
    }
}

export class ObjectIdError extends Error {
    status: number

    constructor(message: string) {
        super(message);
        this.status = 404;
        Object.setPrototypeOf(this, ObjectIdError.prototype);
    }
}

export class IncorrectPermissionsError extends Error {
    status: number

    constructor(message: string) {
        super(message);
        this.status = 403;
        Object.setPrototypeOf(this, IncorrectPermissionsError.prototype);
    }
}