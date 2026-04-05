package main

import (
	"os"
	"path/filepath"
)

type Cache struct {
	Dir string
}

func NewCache(dir string) *Cache {
	return &Cache{Dir: dir}
}

func (c *Cache) Get(chainId, contentHash string) ([]byte, error) {
	return readFile(filepath.Join(c.Dir, chainId, contentHash))
}

func (c *Cache) Set(chainId, contentHash string, data []byte) error {
	return writeFile(filepath.Join(c.Dir, chainId), contentHash, data)
}

// GetRaw returns bytes stored exactly as fetched from chain (not gunzipped).
// Used for multi-chunk file parts where each chunk is a slice of a gzipped
// payload and can only be decompressed once all chunks are concatenated.
func (c *Cache) GetRaw(chainId, contentHash string) ([]byte, error) {
	return readFile(filepath.Join(c.Dir, chainId, "raw", contentHash))
}

func (c *Cache) SetRaw(chainId, contentHash string, data []byte) error {
	return writeFile(filepath.Join(c.Dir, chainId, "raw"), contentHash, data)
}

func readFile(path string) ([]byte, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		if os.IsNotExist(err) {
			return nil, nil
		}
		return nil, err
	}
	return data, nil
}

func writeFile(dir, name string, data []byte) error {
	if err := os.MkdirAll(dir, 0755); err != nil {
		return err
	}

	tmpFile, err := os.CreateTemp(dir, ".tmp-*")
	if err != nil {
		return err
	}
	tmpPath := tmpFile.Name()

	if _, err := tmpFile.Write(data); err != nil {
		tmpFile.Close()
		os.Remove(tmpPath)
		return err
	}
	if err := tmpFile.Close(); err != nil {
		os.Remove(tmpPath)
		return err
	}

	finalPath := filepath.Join(dir, name)
	if err := os.Rename(tmpPath, finalPath); err != nil {
		os.Remove(tmpPath)
		return err
	}

	return nil
}
