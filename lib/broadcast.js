let _io = null;

function setIO(io) { _io = io; }

function toOwner(ownerKey, event, data) {
  if (_io && ownerKey) _io.to(`owner:${ownerKey}`).emit(event, data);
}

function toAll(event, data) {
  if (_io) _io.emit(event, data);
}

module.exports = { setIO, toOwner, toAll };
